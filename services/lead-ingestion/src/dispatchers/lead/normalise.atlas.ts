import { IT } from "./atlas/IT";
import { EN } from "./atlas/EN";
import { ES } from "./atlas/ES";
import { PL } from "./atlas/PL";

export const FIELD_ALIAS_MAP = { ...IT, ...EN, ...ES, ...PL } as const;
