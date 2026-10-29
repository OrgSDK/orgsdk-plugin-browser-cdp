import {
	type Browser,
	type BrowserContext,
	chromium,
	type Page,
} from "playwright-core";
import type { BrowserConfig } from "./config";
import { connectionOptions } from "./config";

export type ConnectBrowser = typeof chromium.connectOverCDP;

async function boundedOperation<Result>(
	operation: () => Promise<Result>,
	timeoutMs: number,
): Promise<Result> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`Browser operation exceeded ${timeoutMs}ms.`)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

export class BrowserSession {
	readonly pagesToClose = new Set<Page>();

	constructor(readonly context: BrowserContext) {}

	async pageId(page: Page): Promise<string> {
		const session = await this.context.newCDPSession(page);
		try {
			const { targetInfo } = await session.send("Target.getTargetInfo");
			return targetInfo.targetId;
		} finally {
			await session.detach();
		}
	}

	async describePage(page: Page) {
		return {
			pageId: await this.pageId(page),
			url: page.url(),
			title: await page.title(),
		};
	}

	async page(pageId: string): Promise<Page> {
		for (const page of this.context.pages()) {
			if (page.isClosed()) {
				continue;
			}
			try {
				if ((await this.pageId(page)) === pageId) {
					return page;
				}
			} catch (error) {
				if (!page.isClosed()) {
					throw error;
				}
			}
		}
		throw new Error(
			"Page is no longer available. Call listPages to obtain a current pageId.",
		);
	}
}

export async function withBrowser<Result>(
	config: BrowserConfig,
	credentials: unknown,
	operation: (session: BrowserSession) => Promise<Result>,
	connect: ConnectBrowser = chromium.connectOverCDP.bind(chromium),
): Promise<Result> {
	let options: ReturnType<typeof connectionOptions>;
	try {
		options = connectionOptions(config, credentials);
	} catch {
		// Validation errors can contain malformed secret JSON, so do not forward them.
		throw new Error(
			"Invalid browser connection credentials or session. Check secret_apiKey, secret_headers JSON, authMode and the existing Steel sessionId.",
		);
	}
	let browser: Browser;
	try {
		browser = await connect(options.endpoint, {
			headers: options.headers,
			timeout: config.connectTimeoutMs,
			noDefaults: true,
		});
	} catch {
		// Playwright connection errors include the full URL and may include auth headers.
		throw new Error(
			"Cannot connect to the remote browser. Check the CDP endpoint, credentials, session lifetime and executor network access.",
		);
	}
	let session: BrowserSession | undefined;
	try {
		const context = browser.contexts()[0];
		if (!context) {
			throw new Error("The remote browser has no default context.");
		}
		context.setDefaultTimeout(config.actionTimeoutMs);
		context.setDefaultNavigationTimeout(config.actionTimeoutMs);
		session = new BrowserSession(context);
		const activeSession = session;
		return await boundedOperation(
			() => operation(activeSession),
			config.actionTimeoutMs,
		);
	} finally {
		// A timed-out openPage must close its new tab before disconnecting cancels navigation.
		await Promise.all(
			[...(session?.pagesToClose ?? [])].map((page) =>
				page.close().catch(() => {}),
			),
		);
		// connectOverCDP's close disconnects the client; we never create or close contexts.
		await browser.close().catch(() => {});
	}
}
