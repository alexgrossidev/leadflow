const KEYGEN_REGISTRY = {
  CUSTOMER_BULK_IMPORT: "customer_bulk_import",
  CUSTOMER_DOCUMENT: "customer_document",
};

export type KeyGenPath = keyof typeof KEYGEN_REGISTRY;
