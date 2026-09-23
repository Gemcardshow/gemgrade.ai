/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["openai", "@apple/app-store-server-library"],
    outputFileTracingIncludes: {
      "/api/credits/apple/verify": ["./certs/apple/*.cer"],
    },
  },
};

export default nextConfig;
