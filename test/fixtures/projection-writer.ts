import { readFileSync } from "node:fs";
import { writeProjections } from "../../src/projection.ts";
import type { TopicProjection } from "../../src/projection.ts";

const [topicDir, projectionPath, mode] = process.argv.slice(2);
if (!topicDir || !projectionPath || !mode) {
  throw new Error("usage: projection-writer TOPIC_DIR PROJECTION_JSON publish|crash-before-publish");
}

const projection = JSON.parse(readFileSync(projectionPath, "utf8")) as TopicProjection;
writeProjections(topicDir, projection, mode === "crash-before-publish"
  ? { beforePublish: () => process.exit(73) }
  : {});
