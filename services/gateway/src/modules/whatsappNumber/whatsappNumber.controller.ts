import { Request, Response } from "express";
import { created, noContent } from "#core/http/response";
import { getTenant } from "#core/http/request-context";
import { WhatsappNumberService } from "./whatsappNumber.service.js";
import { phoneNumberSchema, whatsappNumberBodySchema } from "./whatsappNumber.schema.js";

export class WhatsappNumberController {
  constructor(private readonly service: WhatsappNumberService) {}

  add = async (req: Request, res: Response) => {
    const { phoneNumber } = whatsappNumberBodySchema.parse(req.body);
    const { businessId, userId } = getTenant(req);
    await this.service.addNumber(businessId, userId, phoneNumber);
    return created(res, { phoneNumber });
  };

  remove = async (req: Request, res: Response) => {
    const phoneNumber = phoneNumberSchema.parse(req.params.phoneNumber);
    const { businessId, userId } = getTenant(req);
    await this.service.removeNumber(businessId, userId, phoneNumber);
    return noContent(res);
  };
}
