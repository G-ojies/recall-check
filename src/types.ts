export type Kind = 'product' | 'vehicle' | 'food' | 'medicine';
export type Source = 'CPSC' | 'NHTSA' | 'FDA';

/** One recall, reduced to what is needed to match it and to tell someone what to do about it. */
export interface Recall {
  /** source-prefixed id, e.g. "cpsc:26789", "nhtsa:21V215000", "fda:H-1331-2026" */
  id: string;
  source: Source;
  kind: Kind;
  /** ISO date, yyyy-mm-dd */
  date: string;
  title: string;
  /** who made or sold it: brand, manufacturer, importer, recalling firm */
  brandText: string;
  /** what it is: product names, types, description */
  productText: string;
  /** model numbers named by the recall, normalised (upper-case letters and digits only) */
  models: string[];
  hazard: string;
  remedy: string;
  /** "Refund", "Repair", "Replace" ... */
  remedyOptions: string[];
  contact: string;
  url: string;
  /** for a vehicle, the part that is recalled, in plain words: "air bags" */
  part?: string;
  /** true when the agency says to stop using it now (FDA Class I, NHTSA park-it / park-outside) */
  urgent: boolean;
}

/** Something the household owns. */
export interface Item {
  id: string;
  kind: Kind;
  brand: string;
  /** what it is, in the owner's words: "air fryer", "stroller", "Civic" */
  name: string;
  model?: string;
  year?: number;
  addedAt: string;
}

export type Confidence = 'confirmed' | 'likely' | 'possible';

export interface Match {
  item: Item;
  recall: Recall;
  confidence: Confidence;
  /** one short sentence on why this recall was matched to this item */
  why: string;
}

export interface Household {
  items: Item[];
  /** recall ids the owner has said they dealt with, keyed by item id */
  handled: Record<string, string[]>;
  /** recall ids already reported to the owner, keyed by item id */
  seen: Record<string, string[]>;
  /** vehicle recalls fetched from NHTSA, keyed by item id */
  vehicleRecalls: Record<string, { fetchedAt: string; recalls: Recall[] }>;
}
