import type { AtlasField } from "../../../modules_inbound/fbLead/lead.schema";

export const PL: Record<string, AtlasField> = {
  // ==========================================
  // NAME (first/last parts are joined into fullName by the normaliser)
  // ==========================================
  full_name: "fullName",
  fullname: "fullName",
  "full name": "fullName",
  name: "fullName",
  imie_i_nazwisko: "fullName",
  "imie i nazwisko": "fullName",
  imię_i_nazwisko: "fullName",
  "imię i nazwisko": "fullName",
  imie: "firstName",
  imię: "firstName",
  nazwisko: "lastName",
  nazwa: "fullName",
  "nazwa użytkownika": "fullName",
  nazwa_uzytkownika: "fullName",
  "twoje imię": "fullName",
  twoje_imie: "fullName",
  kontakt: "fullName",

  // ==========================================
  // EMAIL
  // ==========================================
  email: "email",
  "e-mail": "email",
  email_address: "email",
  "email address": "email",
  "adres e-mail": "email",
  "adres email": "email",
  adres_email: "email",
  "twój e-mail": "email",
  twoj_email: "email",
  mail: "email",
  poczta: "email",

  // ==========================================
  // PHONE
  // ==========================================
  phone: "phoneNumber",
  phone_number: "phoneNumber",
  "phone number": "phoneNumber",
  telefon: "phoneNumber",
  "numer telefonu": "phoneNumber",
  numer_telefonu: "phoneNumber",
  nr_telefonu: "phoneNumber",
  "nr telefonu": "phoneNumber",
  komorka: "phoneNumber",
  komórka: "phoneNumber",
  "telefon komórkowy": "phoneNumber",
  telefon_komorkowy: "phoneNumber",
  "numer komórkowy": "phoneNumber",
  tel: "phoneNumber",
  "twój telefon": "phoneNumber",
  kontakt_telefoniczny: "phoneNumber",

  // ==========================================
  // CITY
  // ==========================================
  city: "city",
  town: "city",
  miasto: "city",
  miejscowosc: "city",
  miejscowość: "city",
  lokalizacja: "city",
  gmina: "city",

  // ==========================================
  // POSTAL CODE
  // ==========================================
  postal_code: "postalCode",
  zip: "postalCode",
  "kod pocztowy": "postalCode",
  kod_pocztowy: "postalCode",
  kod: "postalCode",
  zip_code: "postalCode",

  // ==========================================
  // COMPANY
  // ==========================================
  company: "companyName",
  company_name: "companyName",
  "company name": "companyName",
  firma: "companyName",
  "nazwa firmy": "companyName",
  nazwa_firmy: "companyName",
  przedsiebiorstwo: "companyName",
  przedsiębiorstwo: "companyName",
  biznes: "companyName",
  organizacja: "companyName",
  instytucja: "companyName",
  dg: "companyName", // Abbreviation for Działalność Gospodarcza (Sole proprietorship)

  // ==========================================
  // ADDRESS
  // ==========================================
  address: "address",
  adres: "address",
  ulica: "address",
  ul: "address",
  "adres zamieszkania": "address",
  adres_zamieszkania: "address",
  "adres korespondencyjny": "address",
  "pełen adres": "address",
  "adres dostawy": "address",

  // ==========================================
  // STATE / PROVINCE
  // ==========================================
  state: "state",
  province: "state",
  region: "state",
  wojewodztwo: "state",
  województwo: "state",
  woj: "state",
  stan: "state",

  // ==========================================
  // COUNTRY
  // ==========================================
  country: "country",
  kraj: "country",
  panstwo: "country",
  państwo: "country",

  // ==========================================
  // WEBSITE
  // ==========================================
  website: "website",
  web_site: "website",
  url: "website",
  homepage: "website",
  "strona www": "website",
  strona_www: "website",
  www: "website",
  "strona internetowa": "website",
  strona_internetowa: "website",
  link: "website",

  // ==========================================
  // MESSAGE / NOTES
  // ==========================================
  message: "message",
  wiadomosc: "message",
  wiadomość: "message",
  "twoja wiadomość": "message",
  twoja_wiadomosc: "message",
  notatka: "message",
  notatki: "message",
  uwagi: "message", // "Comments / Remarks" - highly common in PL checkout/lead forms
  komentarz: "message",
  komentarze: "message",
  opis: "message",
  tresc: "message",
  treść: "message",
  szczegoly: "message",
  szczegóły: "message",
  zapytanie: "message",
  informacje: "message",
} as const;
