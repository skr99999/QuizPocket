import UIKit
import WebKit
import XCTest
@testable import QuizPocket

final class DocumentImportTests: XCTestCase {
    @MainActor
    func testExcelImportAndProgressSurviveReload() async throws {
        // Exercise the native import entry point after the OS has supplied a file URL.
        let controller: QuizViewController = try await waitFor("App scene did not open") {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .compactMap { $0.rootViewController as? QuizViewController }
                .first
        }
        let web = try XCTUnwrap(controller.view.subviews.compactMap { $0 as? WKWebView }.first)
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "Excel题库示例", withExtension: "xlsx"))
        let name = "Excel题库示例-" + UUID().uuidString
        let document = FileManager.default.temporaryDirectory.appendingPathComponent(name + ".xlsx")
        try FileManager.default.copyItem(at: fixture, to: document)
        defer { try? FileManager.default.removeItem(at: document) }

        try await waitInPage(web, "Question bank did not initialize", """
            window.isSecureContext && !!window.crypto.subtle && typeof window.crypto.randomUUID === "function" &&
              document.getElementById("banks")?.options.length > 0
            """)
        controller.open(document)
        try await waitInPage(web, "Excel import did not complete", """
            document.getElementById("message")?.textContent.includes("已导入") &&
              document.getElementById("summary")?.textContent.startsWith("4 题")
            """)

        let selected = try await script(web, """
            return document.getElementById("banks").selectedOptions[0].textContent;
            """)
        XCTAssertEqual(selected as? String, name)
        let bankID = try await script(web, "return document.getElementById('banks').value;")
        let id = try XCTUnwrap(bankID as? String)
        let storedCount = try await script(web, """
            return await storedBanks("readonly", store => store.get(id)).then(item => item?.questions.length);
            """, ["id": id])
        XCTAssertEqual(storedCount as? Int, 4)

        let position = try await script(web, """
            document.getElementById("start").click();
            document.getElementById("next").click();
            return JSON.parse(localStorage.getItem("quiz-pocket:v1:state:" + id)).session.index;
            """, ["id": id])
        XCTAssertEqual(position as? Int, 1)

        controller.open(document)
        try await waitInPage(web, "Duplicate import did not preserve progress", """
            document.getElementById("message")?.textContent.includes("已打开同名题库")
            """)
        let sameBankCount = try await script(web, """
            const items = await storedBanks("readonly", store => store.getAll());
            return items.filter(item => item.name === name).length;
            """, ["name": name])
        XCTAssertEqual(sameBankCount as? Int, 1)

        _ = try await script(web, "window.quizPocketTestBeforeReload = true;")
        web.reload()
        try await waitInPage(web, "The reloaded page did not restore the selected bank", """
            !window.quizPocketTestBeforeReload &&
              document.getElementById("banks")?.selectedOptions[0]?.textContent.startsWith("Excel题库示例-") &&
              document.getElementById("summary")?.textContent.startsWith("4 题")
            """)
        let restored = try await script(web, """
            const active = JSON.parse(localStorage.getItem("quiz-pocket:v1:active"));
            document.getElementById("start").click();
            return active === id && document.getElementById("position").textContent === "第 2 / 4 题";
            """, ["id": id])
        XCTAssertEqual(restored as? Bool, true)
    }

    @MainActor
    private func script(_ web: WKWebView, _ body: String, _ arguments: [String: Any] = [:]) async throws -> Any? {
        try await web.callAsyncJavaScript(body, arguments: arguments, in: nil, contentWorld: .page)
    }

    @MainActor
    private func waitInPage(_ web: WKWebView, _ failure: String, _ predicate: String) async throws {
        let _: Bool = try await waitFor(failure) {
            ((try? await self.script(web, "return Boolean(" + predicate + ");")) as? Bool) == true ? true : nil
        }
    }

    @MainActor
    private func waitFor<T>(_ failure: String, _ read: () async -> T?) async throws -> T {
        let deadline = ContinuousClock.now + .seconds(20)
        while ContinuousClock.now < deadline {
            if let result = await read() { return result }
            try await Task.sleep(for: .milliseconds(100))
        }
        return try XCTUnwrap(nil as T?, failure)
    }
}
