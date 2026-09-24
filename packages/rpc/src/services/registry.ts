import {
  //lead
  LeadServiceClient,
  LeadServiceService as LeadService,

  //Customer
  CustomerServiceClient,
  CustomerServiceService as CustomerService,
} from "../gen/index.js";

export const SERVICE_REGISTRY = {
  lead: LeadService,
  customer: CustomerService,
};

export const CLIENT_REGISTRY = {
  lead: LeadServiceClient,
  customer: CustomerServiceClient,
};

export type ServiceName = keyof typeof SERVICE_REGISTRY;
export type ClientName = keyof typeof CLIENT_REGISTRY;
