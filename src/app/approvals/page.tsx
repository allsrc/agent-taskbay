import { redirect } from "next/navigation";

/** The standalone Approvals queue is folded into the unified inbox. */
export default function ApprovalsIndexPage() {
  redirect("/inbox?kind=approval&view=needs-input");
}
