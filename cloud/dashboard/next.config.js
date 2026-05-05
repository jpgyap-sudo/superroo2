/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	// Disable etag for static files to avoid caching issues in standalone mode
	generateEtags: false,
	async rewrites() {
		return [
			{
				source: "/api/:path*",
				destination: "http://localhost:8787/:path*",
			},
		]
	},
}

module.exports = nextConfig
