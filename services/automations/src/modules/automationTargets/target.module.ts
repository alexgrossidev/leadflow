import { ContactRepository } from "../contacts/contact.repo";
import { PauseRepository } from "./pause.repo";
import { TargetRepository } from "./target.repo";

export const targetRepo = new TargetRepository();
export const contactRepo = new ContactRepository();
export const pauseRepo = new PauseRepository();
