import type { AtlasField } from "../../../modules_inbound/fbLead/lead.schema";

export const EN: Record<string, AtlasField> = {
  // ==========================================
  // NAME (first/last parts are joined into fullName by the normaliser)
  // ==========================================
  full_name: "fullName",
  fullname: "fullName",
  "full name": "fullName",
  name: "fullName",
  "your name": "fullName",
  your_name: "fullName",
  contact_name: "fullName",
  "contact name": "fullName",
  first_name: "firstName",
  last_name: "lastName",
  "first name": "firstName",
  "last name": "lastName",
  firstname: "firstName",
  lastname: "lastName",
  given_name: "firstName",
  "given name": "firstName",
  surname: "lastName",
  family_name: "lastName",
  "family name": "lastName",
  customer_name: "fullName",
  "customer name": "fullName",

  // ==========================================
  // EMAIL
  // ==========================================
  email: "email",
  "e-mail": "email",
  email_address: "email",
  "email address": "email",
  emailaddress: "email",
  "your email": "email",
  your_email: "email",
  mail_address: "email",
  "mail address": "email",
  contact_email: "email",
  "contact email": "email",
  e_mail: "email",

  // ==========================================
  // PHONE
  // ==========================================
  phone: "phoneNumber",
  phone_number: "phoneNumber",
  "phone number": "phoneNumber",
  phonenumber: "phoneNumber",
  telephone: "phoneNumber",
  "telephone number": "phoneNumber",
  telephone_number: "phoneNumber",
  mobile: "phoneNumber",
  mobile_phone: "phoneNumber",
  "mobile phone": "phoneNumber",
  mobile_number: "phoneNumber",
  "mobile number": "phoneNumber",
  cell: "phoneNumber",
  cellphone: "phoneNumber",
  cell_phone: "phoneNumber",
  "cell phone": "phoneNumber",
  tel: "phoneNumber",
  tel_no: "phoneNumber",
  "tel no": "phoneNumber",
  contact_number: "phoneNumber",
  "contact number": "phoneNumber",
  "your phone": "phoneNumber",

  // ==========================================
  // CITY
  // ==========================================
  city: "city",
  town: "city",
  city_town: "city",
  "city/town": "city",
  location: "city",
  locality: "city",
  suburb: "city", // Common in Australia/NZ instead of neighborhood/city
  municipality: "city",

  // ==========================================
  // POSTAL CODE
  // ==========================================
  postal_code: "postalCode",
  "postal code": "postalCode",
  postalcode: "postalCode",
  zip: "postalCode",
  zip_code: "postalCode",
  "zip code": "postalCode",
  zipcode: "postalCode",
  postcode: "postalCode",
  post_code: "postalCode",
  "post code": "postalCode",

  // ==========================================
  // COMPANY
  // ==========================================
  company: "companyName",
  company_name: "companyName",
  "company name": "companyName",
  companyname: "companyName",
  business: "companyName",
  business_name: "companyName",
  "business name": "companyName",
  organization: "companyName",
  organisation: "companyName",
  firm: "companyName",
  employer: "companyName",
  agency: "companyName",
  corporate_name: "companyName",
  "corporate name": "companyName",

  // ==========================================
  // ADDRESS
  // ==========================================
  address: "address",
  street: "address",
  street_address: "address",
  "street address": "address",
  streetaddress: "address",
  address_line_1: "address",
  "address line 1": "address",
  address_line1: "address",
  address1: "address",
  full_address: "address",
  "full address": "address",
  billing_address: "address",
  shipping_address: "address",
  residence: "address",

  // ==========================================
  // STATE / PROVINCE
  // ==========================================
  state: "state",
  province: "state",
  region: "state",
  state_province: "state",
  "state/province": "state",
  county: "state", // Common in the UK/Ireland
  territory: "state",

  // ==========================================
  // COUNTRY
  // ==========================================
  country: "country",
  nation: "country",
  country_region: "country",
  "country/region": "country",

  // ==========================================
  // WEBSITE
  // ==========================================
  website: "website",
  web_site: "website",
  "web site": "website",
  url: "website",
  homepage: "website",
  link: "website",
  site: "website",
  "website url": "website",
  website_url: "website",

  // ==========================================
  // MESSAGE / NOTES
  // ==========================================
  message: "message",
  "your message": "message",
  your_message: "message",
  notes: "message",
  note: "message",
  comment: "message",
  comments: "message",
  description: "message",
  text: "message",
  details: "message",
  request: "message",
  inquiry: "message",
  enquiry: "message",
  "enquiry details": "message",
  "how can we help": "message",
  feedback: "message",
} as const;
