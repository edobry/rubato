import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
	plugins: [
		glsl(),
		viteStaticCopy({
			targets: [
				{
					src: "node_modules/@mediapipe/tasks-vision/wasm/*",
					dest: "mediapipe/wasm",
				},
			],
		}),
	],
});
