/** @type {import('next').NextConfig} */
const nextConfig = {
	// Standalone mode uses symlinks which require admin/Developer Mode on Windows
	output: process.platform === "win32" ? undefined : "standalone",
	generateEtags: false,
	eslint: { ignoreDuringBuilds: true },
	async rewrites() {
		const apiBase = process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787"
		return [
			{
				source: "/api/:path*",
				destination: `${apiBase}/api/:path*`,
			},
			{
				source: "/visual-crawl/:path*",
				destination: `${apiBase}/visual-crawl/:path*`,
			},
		]
	},
}

module.exports = nextConfig
