import { dataRoot } from "../../lib/data-root.ts";
import App from "../../components/App";
import { loadFullSnapshotData } from "../../lib/datafiles";
import { loadSnapshot } from "../../lib/pipeline";

export const dynamic = "force-dynamic";

export default function Page() {
  const s = loadSnapshot();
  return <App initial={{ ...s, ...loadFullSnapshotData(dataRoot()) }} initialView="engine" />;
}
