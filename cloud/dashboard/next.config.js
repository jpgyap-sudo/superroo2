/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	generateEtags: false,
	eslint: { ignoreDuringBuilds: true },
	async rewrites() {
		return [
			{
				source: "/api/:path*",
				// API_INTERNAL_URL is used server-side inside Docker containers
				// NEXT_PUBLIC_API_URL is used client-side (browser → host port)
				// Falls back to localhost:8787 for PM2/host mode
				destination: `${process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8787"}/:path*`,
			},
		]
	},
}

module.exports = nextConfig
