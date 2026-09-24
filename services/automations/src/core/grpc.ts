import { createGrpcClient, LeadServiceClient } from "@leadflow/rpc";
import { getEnv } from "../config/env";

export const grpcLeadClient = createGrpcClient<LeadServiceClient>(
  LeadServiceClient,
  getEnv().GATEWAY_GRPC_ADDR,
);
