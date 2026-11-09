import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'node_modules/cesium/Build/Cesium/Workers', dest: 'cesium' },
        { src: 'node_modules/cesium/Build/Cesium/Assets', dest: 'cesium' },
        { src: 'node_modules/cesium/Build/Cesium/Widgets', dest: 'cesium' },
        { src: 'node_modules/cesium/Build/Cesium/ThirdParty', dest: 'cesium' },
      ],
    }),
  ],
  build: {
    // main.js 用顶层 await 动态引入 Cesium，需要 esnext 目标
    target: 'esnext',
    chunkSizeWarningLimit: 8000,
  },
});
