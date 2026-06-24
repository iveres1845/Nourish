/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Prevent webpack from bundling openai — lets it use Node's native fetch
    // instead of node-fetch, which fixes ERR_STREAM_PREMATURE_CLOSE
    serverComponentsExternalPackages: ['openai'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // Required for reading YAML files in lib/engine
  webpack: (config) => {
    config.module.rules.push({
      test: /\.yaml$/,
      use: 'raw-loader',
    })
    return config
  },
}

module.exports = nextConfig
