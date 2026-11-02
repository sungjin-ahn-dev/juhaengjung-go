import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// 한 파일짜리 체험 페이지: 판매자 앱 + 차량 앱 + 서버 코드(메모리 저장소)를 모두 넣는다
export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile()],
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
});
