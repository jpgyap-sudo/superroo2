/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	generateEtags: false,
	eslint: { ignoreDuringBuilds: true },
	async rewrites() {
		return [
			{
				source: "/api/:path*",
				// Use NEXT_PUBLIC_API_URL env var for Docker networking (superroo-api:8787)
				// Falls back to localhost:8787 for PM2/host mode
				destination: `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787"}/:path*`,
			},
		]
	},
}

module.exports = nextConfig
