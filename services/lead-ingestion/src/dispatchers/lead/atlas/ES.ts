import type { AtlasField } from "../../../modules_inbound/fbLead/lead.schema";

export const ES: Record<string, AtlasField> = {
  // ==========================================
  // NAME (first/last parts are joined into fullName by the normaliser)
  // ==========================================
  full_name: "fullName",
  fullname: "fullName",
  "full name": "fullName",
  name: "fullName",
  nombre: "firstName",
  "nombre completo": "fullName",
  nombre_completo: "fullName",
  nombrecompleto: "fullName",
  "nombre y apellido": "fullName",
  nombre_y_apellido: "fullName",
  "nombre y apellidos": "fullName",
  nombre_y_apellidos: "fullName",
  "nombres y apellidos": "fullName",
  nombres_y_apellidos: "fullName",
  apellidos: "lastName",
  apellido: "lastName",
  "primer nombre": "firstName",
  "tu nombre": "fullName",
  tu_nombre: "fullName",
  contacto: "fullName",
  "nombre del contacto": "fullName",

  // ==========================================
  // EMAIL
  // ==========================================
  email: "email",
  "e-mail": "email",
  email_address: "email",
  "email address": "email",
  correo: "email",
  "correo electronico": "email",
  "correo electrónico": "email",
  correo_electronico: "email",
  "dirección de correo": "email",
  direccion_de_correo: "email",
  "tu correo": "email",
  tu_correo: "email",
  mail: "email",
  contacto_email: "email",

  // ==========================================
  // PHONE
  // ==========================================
  phone: "phoneNumber",
  phone_number: "phoneNumber",
  "phone number": "phoneNumber",
  telefono: "phoneNumber",
  teléfono: "phoneNumber",
  "numero de telefono": "phoneNumber",
  "número de teléfono": "phoneNumber",
  numero_telefono: "phoneNumber",
  "numero telefonico": "phoneNumber",
  "número telefónico": "phoneNumber",
  celular: "phoneNumber",
  movil: "phoneNumber",
  móvil: "phoneNumber",
  "numero celular": "phoneNumber",
  "número celular": "phoneNumber",
  tel: "phoneNumber",
  telef: "phoneNumber",
  fijo: "phoneNumber", // Landline
  "telefono fijo": "phoneNumber",
  "tu telefono": "phoneNumber",
  "contacto telefonico": "phoneNumber",

  // ==========================================
  // CITY
  // ==========================================
  city: "city",
  town: "city",
  ciudad: "city",
  pueblo: "city",
  localidad: "city",
  municipio: "city",
  comuna: "city", // Common in Chile/Colombia
  poblacion: "city",
  población: "city",
  delegacion: "city", // Common in Mexico

  // ==========================================
  // POSTAL CODE
  // ==========================================
  postal_code: "postalCode",
  zip: "postalCode",
  "codigo postal": "postalCode",
  "código postal": "postalCode",
  codigo_postal: "postalCode",
  cp: "postalCode",
  c_p: "postalCode",
  zip_code: "postalCode",

  // ==========================================
  // COMPANY
  // ==========================================
  company: "companyName",
  company_name: "companyName",
  "company name": "companyName",
  empresa: "companyName",
  "nombre empresa": "companyName",
  nombre_empresa: "companyName",
  "nombre de la empresa": "companyName",
  compania: "companyName",
  compañía: "companyName",
  negocio: "companyName",
  "nombre del negocio": "companyName",
  organizacion: "companyName",
  organización: "companyName",
  "razon sociale": "companyName",
  "razón social": "companyName",
  razon_social: "companyName",
  corporacion: "companyName",

  // ==========================================
  // ADDRESS
  // ==========================================
  address: "address",
  direccion: "address",
  dirección: "address",
  calle: "address",
  "direccion completa": "address",
  "dirección completa": "address",
  "direccion de envio": "address",
  "dirección de envío": "address",
  "direccion de facturacion": "address",
  domicilio: "address",
  residencia: "address",

  // ==========================================
  // STATE / PROVINCE
  // ==========================================
  state: "state",
  province: "state",
  provincia: "state",
  region: "state",
  región: "state",
  estado: "state",
  departamento: "state", // Common in Peru/Colombia
  comunidad: "state", // Common in Spain (Comunidad Autónoma)

  // ==========================================
  // COUNTRY
  // ==========================================
  country: "country",
  pais: "country",
  país: "country",
  nacion: "country",
  nación: "country",

  // ==========================================
  // WEBSITE
  // ==========================================
  website: "website",
  web_site: "website",
  url: "website",
  homepage: "website",
  "sitio web": "website",
  sitioweb: "website",
  sitio_web: "website",
  web: "website",
  "pagina web": "website",
  "página web": "website",
  link: "website",

  // ==========================================
  // MESSAGE / NOTES
  // ==========================================
  message: "message",
  mensaje: "message",
  "tu mensaje": "message",
  nota: "message",
  notas: "message",
  comentario: "message",
  comentarios: "message",
  descripcion: "message",
  descripción: "message",
  texto: "message",
  detalles: "message",
  asunto: "message", // Subject line, often treated as part of the primary message body in simpler web hooks
  consulta: "message",
  solicitud: "message",
  informacion: "message",
  información: "message",
} as const;
