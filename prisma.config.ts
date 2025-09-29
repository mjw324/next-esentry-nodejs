import { defineConfig } from "prisma/config";
import path from "path";

export default defineConfig({
  schema: path.join("node_modules", "@mjw324", "prisma-shared", "prisma", "schema.prisma"),
});