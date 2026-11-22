import Foundation
import Network

final class LoopbackServer {
    // The port is part of the WebKit storage origin. Keep it stable across releases.
    static let port: NWEndpoint.Port = 49173
    static let host = "127.0.0.1:49173"
    static let home = URL(string: "http://\(host)/assets/index.html")!

    private let queue = DispatchQueue(label: "net.quizpocket.loopback")
    private let listener: NWListener
    private let assets: [String: (String, Data)]

    init(bundle: Bundle = .main) throws {
        let files = [
            "index.html": "text/html; charset=utf-8",
            "style.css": "text/css; charset=utf-8",
            "bank.js": "application/javascript; charset=utf-8",
            "office.js": "application/javascript; charset=utf-8",
            "app.js": "application/javascript; charset=utf-8",
            "share.js": "application/javascript; charset=utf-8",
            "xlsx.full.min.js": "application/javascript; charset=utf-8",
            "mammoth.browser.min.js": "application/javascript; charset=utf-8",
        ]
        let directory = bundle.resourceURL!.appendingPathComponent("assets", isDirectory: true)
        var assets: [String: (String, Data)] = [:]
        for (file, type) in files {
            assets["/assets/" + file] = (type, try Data(contentsOf: directory.appendingPathComponent(file)))
        }
        self.assets = assets

        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: Self.port)
        listener = try NWListener(using: parameters)
    }

    func start(onState: @escaping (NWListener.State) -> Void) {
        listener.stateUpdateHandler = onState
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            connection.start(queue: self.queue)
            self.receive(connection, buffer: Data())
            self.queue.asyncAfter(deadline: .now() + 10) { [weak connection] in
                connection?.cancel()
            }
        }
        listener.start(queue: queue)
    }

    deinit { listener.cancel() }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, complete, error in
            guard let self, error == nil else { connection.cancel(); return }
            let request = buffer + (data ?? Data())
            if request.count > 16_384 {
                self.respond(connection, status: "431 Request Header Fields Too Large")
            } else if let end = request.range(of: Data([13, 10, 13, 10]))?.lowerBound {
                self.handle(connection, header: String(decoding: request.prefix(end), as: UTF8.self))
            } else if complete {
                connection.cancel()
            } else {
                self.receive(connection, buffer: request)
            }
        }
    }

    private func handle(_ connection: NWConnection, header: String) {
        let lines = header.components(separatedBy: "\r\n")
        let request = lines[0].split(separator: " ")
        let hosts = lines.dropFirst().compactMap { line -> String? in
            let parts = line.split(separator: ":", maxSplits: 1)
            guard parts.count == 2, parts[0].lowercased() == "host" else { return nil }
            return parts[1].trimmingCharacters(in: .whitespaces)
        }
        guard request.count == 3, request[0] == "GET", hosts == [Self.host] else {
            respond(connection, status: "400 Bad Request")
            return
        }
        guard let (type, data) = assets[String(request[1])] else {
            respond(connection, status: "404 Not Found")
            return
        }
        respond(connection, status: "200 OK", type: type, data: data)
    }

    private func respond(_ connection: NWConnection, status: String, type: String = "text/plain", data: Data = Data()) {
        let headers = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(data.count)\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n\r\n"
        connection.send(content: Data(headers.utf8) + data, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}
