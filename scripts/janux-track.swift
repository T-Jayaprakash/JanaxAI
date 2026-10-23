// janux-track: finds faces and people in a video with Apple's Vision framework.
// Usage: janux-track <video> [samplesPerSecond]
// Prints JSON: { width, height, duration, samples: [{ t, faces: [box], people: [box] }] }
// Boxes are normalised to the displayed frame with a top-left origin: { x, y, w, h, c }.
import AVFoundation
import Foundation
import Vision

func fail(_ message: String, _ code: Int32) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(code)
}

let args = CommandLine.arguments
if args.count < 2 { fail("usage: janux-track <video> [samplesPerSecond]", 2) }
let rate = args.count > 2 ? max(0.5, min(15, Double(args[2]) ?? 4)) : 4
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))

let duration: Double
let displaySize: CGSize
do {
  duration = try await asset.load(.duration).seconds
  guard let track = try await asset.loadTracks(withMediaType: .video).first else { fail("no video track", 3) }
  let natural = try await track.load(.naturalSize)
  let transform = try await track.load(.preferredTransform)
  let shown = natural.applying(transform)
  displaySize = CGSize(width: abs(shown.width), height: abs(shown.height))
} catch {
  fail("could not read video: \(error.localizedDescription)", 3)
}
if !duration.isFinite || duration <= 0 { fail("video has no duration", 3) }

let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.maximumSize = CGSize(width: 640, height: 640)
let tolerance = CMTime(seconds: 0.5 / rate, preferredTimescale: 600)
generator.requestedTimeToleranceBefore = tolerance
generator.requestedTimeToleranceAfter = tolerance

let times = stride(from: 0.0, to: duration, by: 1.0 / rate).map { CMTime(seconds: $0, preferredTimescale: 600) }

func box(_ r: CGRect, _ c: Float) -> [String: Double] {
  // Vision uses a bottom-left origin.
  ["x": Double(r.minX), "y": Double(1 - r.maxY), "w": Double(r.width), "h": Double(r.height), "c": Double(c)]
}

var samples: [[String: Any]] = []
for await result in generator.images(for: times) {
  let t = result.requestedTime.seconds
  guard let image = try? result.image else { continue }
  let faces = VNDetectFaceRectanglesRequest()
  let people = VNDetectHumanRectanglesRequest()
  people.upperBodyOnly = true
  do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([faces, people])
  } catch {
    continue
  }
  samples.append([
    "t": (t * 1000).rounded() / 1000,
    "faces": (faces.results ?? []).map { box($0.boundingBox, $0.confidence) },
    "people": (people.results ?? []).map { box($0.boundingBox, $0.confidence) },
  ])
}

let output: [String: Any] = ["width": Double(displaySize.width), "height": Double(displaySize.height), "duration": duration, "samples": samples]
let data = try JSONSerialization.data(withJSONObject: output)
FileHandle.standardOutput.write(data)
