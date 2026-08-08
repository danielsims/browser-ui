// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BrowserUI",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "BrowserUI", targets: ["BrowserUI"]),
    ],
    targets: [
        .target(
            name: "BrowserUI",
            path: "packages/swift/Sources/BrowserUI",
            resources: [.process("Shaders")]),
        .testTarget(
            name: "BrowserUITests",
            dependencies: ["BrowserUI"],
            path: "packages/swift/Tests/BrowserUITests"),
    ])
