#!/usr/bin/env swift

import Foundation
import PDFKit
import Vision
import AppKit

struct Config {
    enum Mode: String {
        case auto
        case pdfText = "pdf-text"
        case ocr
    }

    let path: String
    let mode: Mode
    let scale: CGFloat
}

struct PageSummary: Codable {
    let pageNumber: Int
    let selectedStrategy: String
    let pdfTextChars: Int
    let pdfTextScore: Double
    let ocrTextChars: Int
    let ocrTextScore: Double
}

struct ExtractionResult: Codable {
    let ok: Bool
    let extractor: String
    let pageCount: Int
    let selectedPages: [String: Int]
    let pages: [PageSummary]
    let text: String
}

enum ExtractionError: LocalizedError {
    case missingPath
    case invalidMode(String)
    case openFailed(String)
    case renderFailed(Int)
    case noTextProduced

    var errorDescription: String? {
        switch self {
        case .missingPath:
            return "Missing required --path"
        case .invalidMode(let mode):
            return "Unsupported mode: \(mode)"
        case .openFailed(let path):
            return "Unable to open PDF at \(path)"
        case .renderFailed(let pageNumber):
            return "Unable to render page \(pageNumber)"
        case .noTextProduced:
            return "OCR did not produce readable text for this PDF"
        }
    }
}

func parseArguments() throws -> Config {
    var path: String?
    var mode = Config.Mode.auto
    var scale: CGFloat = 2.0

    var iterator = CommandLine.arguments.dropFirst().makeIterator()
    while let argument = iterator.next() {
        switch argument {
        case "--path":
            path = iterator.next()
        case "--mode":
            guard let raw = iterator.next() else {
                throw ExtractionError.invalidMode("")
            }
            guard let parsed = Config.Mode(rawValue: raw) else {
                throw ExtractionError.invalidMode(raw)
            }
            mode = parsed
        case "--scale":
            guard let raw = iterator.next(), let parsed = Double(raw) else {
                throw ExtractionError.invalidMode(argument)
            }
            scale = CGFloat(parsed)
        default:
            continue
        }
    }

    guard let resolvedPath = path, !resolvedPath.isEmpty else {
        throw ExtractionError.missingPath
    }

    return Config(path: resolvedPath, mode: mode, scale: scale)
}

func qualityScore(_ text: String) -> Double {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        return 0
    }

    let scalars = trimmed.unicodeScalars
    let letters = scalars.filter { CharacterSet.letters.contains($0) }.count
    let whitespace = scalars.filter { CharacterSet.whitespacesAndNewlines.contains($0) }.count
    let punctuation = scalars.filter { CharacterSet.punctuationCharacters.contains($0) }.count
    let total = max(1, scalars.count)
    let words = trimmed.split { $0.isWhitespace }
    let longWords = words.filter { $0.count >= 3 }.count

    let alphaRatio = Double(letters) / Double(total)
    let whitespaceRatio = Double(whitespace) / Double(total)
    let punctuationRatio = Double(punctuation) / Double(total)
    let wordDensity = Double(longWords) / Double(max(1, words.count))
    let lengthScore = min(Double(trimmed.count) / 1200.0, 1.0)

    var score = (0.45 * alphaRatio)
        + (0.15 * whitespaceRatio)
        + (0.20 * wordDensity)
        + (0.15 * lengthScore)
        + (0.05 * min(punctuationRatio * 2.5, 1.0))

    let lowered = trimmed.lowercased()
    let boilerplateSignals = [
        "downloaded from",
        "terms of use",
        "subject to",
        "for personal use only",
        "cambridge core",
        "jstor",
        "copyright",
        "all rights reserved"
    ]
    let boilerplateMatches = boilerplateSignals.filter { lowered.contains($0) }.count
    if boilerplateMatches > 0 {
        score -= Double(boilerplateMatches) * 0.08
    }

    if trimmed.count < 200 {
        score -= 0.08
    }

    return max(0, min(score, 1))
}

func renderPageImage(_ page: PDFPage, scale: CGFloat) throws -> CGImage {
    let bounds = page.bounds(for: .mediaBox)
    let width = Int(bounds.width * scale)
    let height = Int(bounds.height * scale)

    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
        throw ExtractionError.renderFailed(page.pageRef?.pageNumber ?? -1)
    }
    guard let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        throw ExtractionError.renderFailed(page.pageRef?.pageNumber ?? -1)
    }

    context.interpolationQuality = .high
    context.setFillColor(NSColor.white.cgColor)
    context.fill(CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height)))
    context.saveGState()
    context.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: context)
    context.restoreGState()

    guard let image = context.makeImage() else {
        throw ExtractionError.renderFailed(page.pageRef?.pageNumber ?? -1)
    }
    return image
}

func recognizeText(page: PDFPage, scale: CGFloat) throws -> String {
    let image = try renderPageImage(page, scale: scale)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    let text = (request.results ?? [])
        .compactMap { observation in observation.topCandidates(1).first?.string }
        .joined(separator: "\n")
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
}

func shouldTryOCR(pdfText: String, pdfScore: Double, mode: Config.Mode) -> Bool {
    switch mode {
    case .ocr:
        return true
    case .pdfText:
        return false
    case .auto:
        if pdfText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return true
        }
        if pdfText.count < 250 {
            return true
        }
        if pdfScore < 0.58 {
            return true
        }
        let lowered = pdfText.lowercased()
        if (lowered.contains("downloaded from") || lowered.contains("terms of use") || lowered.contains("subject to"))
            && pdfText.count < 800 {
            return true
        }
        return false
    }
}

func selectText(pdfText: String, pdfScore: Double, ocrText: String, ocrScore: Double, mode: Config.Mode) -> (String, String) {
    switch mode {
    case .pdfText:
        return (pdfText, "pdf-text")
    case .ocr:
        return (ocrText, ocrText.isEmpty ? "ocr-empty" : "ocr")
    case .auto:
        if !ocrText.isEmpty {
            let ocrClearlyBetter = ocrScore > (pdfScore + 0.08) && ocrText.count >= max(150, Int(Double(pdfText.count) * 0.6))
            let pdfWeak = pdfScore < 0.55 || pdfText.count < 200
            if ocrClearlyBetter || pdfWeak {
                return (ocrText, "ocr")
            }
        }
        return (pdfText.isEmpty ? ocrText : pdfText, pdfText.isEmpty ? "ocr-fallback" : "pdf-text")
    }
}

func extractorName(for mode: Config.Mode) -> String {
    switch mode {
    case .auto:
        return "local-hybrid"
    case .pdfText:
        return "local-pdfkit-text"
    case .ocr:
        return "local-vision-ocr"
    }
}

func main() throws {
    let config = try parseArguments()
    let url = URL(fileURLWithPath: config.path)
    guard let document = PDFDocument(url: url) else {
        throw ExtractionError.openFailed(config.path)
    }

    var pageSummaries: [PageSummary] = []
    var selectedPages: [String: Int] = [:]
    var combinedPages: [String] = []

    for pageIndex in 0..<document.pageCount {
        guard let page = document.page(at: pageIndex) else {
            continue
        }

        let pdfText = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let pdfScore = qualityScore(pdfText)

        var ocrText = ""
        var ocrScore = 0.0
        if shouldTryOCR(pdfText: pdfText, pdfScore: pdfScore, mode: config.mode) {
            do {
                ocrText = try recognizeText(page: page, scale: config.scale)
                ocrScore = qualityScore(ocrText)
            } catch {
                ocrText = ""
                ocrScore = 0
            }
        }

        let (selectedText, selectedStrategy) = selectText(
            pdfText: pdfText,
            pdfScore: pdfScore,
            ocrText: ocrText,
            ocrScore: ocrScore,
            mode: config.mode
        )

        combinedPages.append(selectedText)
        selectedPages[selectedStrategy, default: 0] += 1
        pageSummaries.append(
            PageSummary(
                pageNumber: pageIndex + 1,
                selectedStrategy: selectedStrategy,
                pdfTextChars: pdfText.count,
                pdfTextScore: pdfScore,
                ocrTextChars: ocrText.count,
                ocrTextScore: ocrScore
            )
        )
    }

    let combinedText = combinedPages
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
        .joined(separator: "\n\n")

    if config.mode == .ocr && combinedText.isEmpty {
        throw ExtractionError.noTextProduced
    }

    let result = ExtractionResult(
        ok: true,
        extractor: extractorName(for: config.mode),
        pageCount: document.pageCount,
        selectedPages: selectedPages,
        pages: pageSummaries,
        text: combinedText
    )

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(result)
    FileHandle.standardOutput.write(data)
}

do {
    try main()
} catch {
    let payload: [String: Any] = [
        "ok": false,
        "error": [
            "message": error.localizedDescription
        ]
    ]
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data)
    exit(1)
}
