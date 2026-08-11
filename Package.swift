// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BrowserUI",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "BrowserUI", targets: ["BrowserUI"]),
        .library(name: "BrowserUIWebKit", targets: ["BrowserUIWebKit"]),
    ],
    targets: [
        .target(
            name: "BrowserUI",
            path: "packages/swift/Sources/BrowserUI",
            resources: [.process("Shaders")]),
        .target(
            name: "BrowserUIWebKit",
            dependencies: ["BrowserUI"],
            path: "packages/swift/Sources/BrowserUIWebKit"),
        .testTarget(
            name: "BrowserUITests",
            dependencies: ["BrowserUI"],
            path: "packages/swift/Tests/BrowserUITests"),
    ])
