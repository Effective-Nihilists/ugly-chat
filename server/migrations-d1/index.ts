import type { D1Migration } from "ugly-app/server";
import { repairIdOnlyFields } from "./001_repair_id_only_fields";
import { dropNullOptionalFields } from "./002_drop_null_optional_fields";

/** Every D1 migration this app ships, in run order. */
export const d1Migrations: readonly D1Migration[] = [
  repairIdOnlyFields,
  dropNullOptionalFields,
];
