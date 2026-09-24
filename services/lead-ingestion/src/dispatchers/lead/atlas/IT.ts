import type { AtlasField } from "../../../modules_inbound/fbLead/lead.schema";

export const IT: Record<string, AtlasField> = {
  // ==========================================
  // NAME (first/last parts are joined into fullName by the normaliser)
  // ==========================================
  full_name: "fullName",
  fullname: "fullName",
  "full name": "fullName",
  nome_e_cognome: "fullName",
  "nome e cognome": "fullName",
  nome: "firstName",
  nome_completo: "fullName",
  "nome completo": "fullName",
  first_name: "firstName",
  last_name: "lastName",
  "first name": "firstName",
  "last name": "lastName",
  name: "fullName",
  nome_cognome: "fullName",
  cognome_nome: "fullName",
  nominativo: "fullName",
  "nome del contatto": "fullName",
  nome_contatto: "fullName",
  "nome o ragione sociale": "fullName", // Often used in Italian B2B forms
  cognome: "lastName",
  "il tuo nome": "fullName",
  il_tuo_nome: "fullName",

  // ==========================================
  // EMAIL
  // ==========================================
  email: "email",
  "e-mail": "email",
  email_address: "email",
  "email address": "email",
  indirizzo_email: "email",
  "indirizzo email": "email",
  indirizzo_mail: "email",
  "indirizzo mail": "email",
  mail: "email",
  posta: "email",
  posta_elettronica: "email",
  "posta elettronica": "email",
  "la tua email": "email",
  la_tua_email: "email",
  contatto_email: "email",

  // ==========================================
  // PHONE
  // ==========================================
  phone: "phoneNumber",
  phone_number: "phoneNumber",
  "phone number": "phoneNumber",
  telefono: "phoneNumber",
  numero_di_telefono: "phoneNumber",
  "numero di telefono": "phoneNumber",
  numero_telefono: "phoneNumber",
  "numero telefono": "phoneNumber",
  mobile: "phoneNumber",
  cellulare: "phoneNumber",
  cell: "phoneNumber",
  tel: "phoneNumber",
  telefono_mobile: "phoneNumber",
  "telefono mobile": "phoneNumber",
  mobile_phone: "phoneNumber",
  "mobile phone": "phoneNumber",
  numero_cellulare: "phoneNumber",
  "numero cellulare": "phoneNumber",
  "recapito telefonico": "phoneNumber",
  recapito_telefonico: "phoneNumber",
  recapito: "phoneNumber",
  contatto_telefonico: "phoneNumber",
  "il tuo telefono": "phoneNumber",

  // ==========================================
  // CITY
  // ==========================================
  city: "city",
  città: "city",
  citta: "city",
  town: "city",
  comune: "city",
  località: "city",
  localita: "city",
  location: "city",
  "città di residenza": "city",
  municipio: "city",

  // ==========================================
  // POSTAL CODE
  // ==========================================
  postal_code: "postalCode",
  zip: "postalCode",
  cap: "postalCode",
  codice_postale: "postalCode",
  "codice postale": "postalCode",
  zip_code: "postalCode",
  "zip code": "postalCode",
  c_a_p: "postalCode",
  codice_avviamento_postale: "postalCode",

  // ==========================================
  // COMPANY
  // ==========================================
  company: "companyName",
  company_name: "companyName",
  "company name": "companyName",
  azienda: "companyName",
  "nome azienda": "companyName",
  nome_azienda: "companyName",
  ditta: "companyName",
  business: "companyName",
  business_name: "companyName",
  "business name": "companyName",
  società: "companyName",
  societa: "companyName",
  ragione_sociale: "companyName",
  "ragione sociale": "companyName",
  impresa: "companyName",
  organizzazione: "companyName",
  ente: "companyName",

  // ==========================================
  // ADDRESS
  // ==========================================
  address: "address",
  indirizzo: "address",
  street: "address",
  via: "address",
  piazza: "address",
  corso: "address",
  strada: "address",
  street_address: "address",
  "street address": "address",
  indirizzo_completo: "address",
  "indirizzo completo": "address",
  "indirizzo di spedizione": "address",
  "indirizzo di fatturazione": "address",
  domicilio: "address",
  residenza: "address",

  // ==========================================
  // STATE / PROVINCE
  // ==========================================
  state: "state",
  province: "state",
  provincia: "state",
  prov: "state",
  regione: "state",
  region: "state",
  stato: "state",
  "provincia o regione": "state",

  // ==========================================
  // COUNTRY
  // ==========================================
  country: "country",
  paese: "country",
  nazione: "country",
  nation: "country",
  "stato federale": "country", // used to handle edge cases where "stato" means country

  // ==========================================
  // WEBSITE
  // ==========================================
  website: "website",
  web_site: "website",
  "web site": "website",
  sito_web: "website",
  "sito web": "website",
  sito: "website",
  url: "website",
  homepage: "website",
  link: "website",

  // ==========================================
  // MESSAGE / NOTES
  // ==========================================
  message: "message",
  messaggio: "message",
  "il tuo messaggio": "message",
  note: "message",
  notes: "message",
  comment: "message",
  commento: "message",
  commenti: "message",
  testo: "message",
  descrizione: "message",
  richiesta: "message",
  "dettagli della richiesta": "message",
  dettagli: "message",
  info: "message",
  informazioni: "message",
} as const;
