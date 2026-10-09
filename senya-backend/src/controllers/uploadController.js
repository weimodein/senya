const { Upload } = require("../models/index.js");
const { HttpError, intParam } = require("../middleware/errors.js");

// DELETE /api/uploads/:id  (its samples go with it)
const remove = async (req, res) => {
  const upload = await Upload.findByPk(intParam(req.params.id));
  if (!upload) throw new HttpError(404, "upload not found");
  await upload.destroy();
  res.status(204).end();
};

module.exports = { remove };
