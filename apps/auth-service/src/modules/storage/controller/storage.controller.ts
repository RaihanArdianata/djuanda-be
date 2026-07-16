import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { catchAsync, failureFromCode, success } from "@repo/shared";
import { fileUtils } from "@repo/shared";
import { utapi } from "@/utils/uploadthing";
import { toWebp } from "../service/image.service";

type UploadBody = {
  file: File;
};

export const upload = catchAsync(async (c) => {
  const { file }: UploadBody = await c.req.parseBody();
  const publicPath = join(process.cwd(), "public");

  if (file instanceof File) {
    const buffer = await file?.arrayBuffer();
    const { convertedBuffer, type } = await toWebp({ file: buffer });
    const { originalName } = fileUtils(file);

    const newFilename = `${originalName}.${type?.ext}`;
    const filepath = join(publicPath, newFilename);

    await writeFile(filepath, Buffer.from(convertedBuffer));

    return success(c, { filepath, file: originalName }, { message: "File uploaded successfully" });
  }

  return failureFromCode(c, "UNSUPPORTED_MEDIA_TYPE");
});

export const uploadThing = catchAsync(async (c) => {
  const { file }: UploadBody = await c.req.parseBody();

  if (file instanceof File) {
    const buffer = await file?.arrayBuffer();

    const { convertedBuffer, type } = await toWebp({ file: buffer });
    const { originalName } = fileUtils(file);
    const newFilename = `${originalName}.${type?.ext}`;

    const fileWithNewName = new File([convertedBuffer], newFilename, {
      type: type?.mime,
    });

    const response = await utapi.uploadFiles([fileWithNewName]);

    return success(c, response, { message: "File uploaded successfully" });
  }

  return failureFromCode(c, "UNSUPPORTED_MEDIA_TYPE");
});
