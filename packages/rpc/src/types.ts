import { ServiceDefinition, UntypedServiceImplementation } from "@grpc/grpc-js";

export type GRPCRegisterableService = {
  definition: ServiceDefinition;
  implementation: UntypedServiceImplementation;
};
