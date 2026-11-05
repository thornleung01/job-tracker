// How a mailbox is named to a person: "Gmail", and "Gmail me@gmail.com". One list for every place that says it.
import type { AccountRow } from "../db/schema";
import { PROVIDER_LABEL } from "../types";

export { PROVIDER_LABEL };

export const accountLabel = (a: Pick<AccountRow, "provider" | "address">): string => `${PROVIDER_LABEL[a.provider]} ${a.address}`;
