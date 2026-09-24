import { CsvLargeUploadController } from "./upload.controller.js";
import { CsvLargeUploadService } from "./upload.service.js";
import { CsvLargeUploadRepository } from "./upload.repo.js";
import { importFailureSources } from "./import-failures.source.js";

export const uploadRepository = new CsvLargeUploadRepository();
export const uploadService = new CsvLargeUploadService(uploadRepository, importFailureSources);
export const uploadController = new CsvLargeUploadController(uploadService);
