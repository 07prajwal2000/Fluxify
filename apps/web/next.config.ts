import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	/* config options here */
	output: "standalone",
	basePath: "/_/admin/ui",
	transpilePackages: [
		"@fluxify/lib",
		"@fluxify/adapters",
		"@fluxify/blocks",
		"@fluxify/ai-gateway",
	],
	images: {
		unoptimized: true,
	},
	outputFileTracingExcludes: {
		"*": [
			"sharp",
			"@img/sharp-linux-x64",
			"@img/sharp-linuxmusl-x64",
			"@img/sharp-libvips-linux-x64",
			"@img/sharp-libvips-linuxmusl-x64",
		],
	},
};

export default nextConfig;
