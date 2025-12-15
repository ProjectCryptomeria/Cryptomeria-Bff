export class GwcClient {
	private endpoint: string;

	constructor(endpoint = process.env.GWC_API_ENDPOINT || 'http://localhost:8080') {
		this.endpoint = endpoint;
	}

	async uploadFile(filename: string, data: Buffer, mimeType = 'application/octet-stream'): Promise<{ success: boolean; timeMs: number }> {
		const formData = new FormData();
		const blob = new Blob([new Uint8Array(data)], { type: mimeType });
		formData.append('file', blob, filename);
		// プロジェクト名等のメタデータが必要ならここで追加
		formData.append('project', 'experiment-auto');

		const start = performance.now();
		try {
			const res = await fetch(`${this.endpoint}/upload`, {
				method: 'POST',
				body: formData,
			});

			if (!res.ok) {
				throw new Error(`GWC Upload Failed: ${res.status} ${res.statusText}`);
			}

			const end = performance.now();
			return { success: true, timeMs: end - start };
		} catch (error) {
			console.error('Upload Error:', error);
			throw error;
		}
	}
}