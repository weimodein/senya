// Sequelize models for migrations/001_init.sql. The SQL file owns the schema; the backend never calls sync().
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db.js");

const common = { timestamps: false, underscored: true };

const Admin = sequelize.define(
  "Admin",
  {
    username: { type: DataTypes.TEXT, allowNull: false, unique: true },
    password_hash: { type: DataTypes.TEXT, allowNull: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { ...common, tableName: "admins" },
);

const Sign = sequelize.define(
  "Sign",
  {
    label: { type: DataTypes.TEXT, allowNull: false, unique: true },
    kind: { type: DataTypes.TEXT, allowNull: false },
    start_shapes: { type: DataTypes.JSONB },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { ...common, tableName: "signs" },
);

const Upload = sequelize.define(
  "Upload",
  {
    sign_id: { type: DataTypes.INTEGER, allowNull: false },
    filename: { type: DataTypes.TEXT, allowNull: false },
    samples_added: { type: DataTypes.INTEGER, defaultValue: 0 },
    segments_found: { type: DataTypes.INTEGER, defaultValue: 0 },
    no_hand_frames: { type: DataTypes.INTEGER, defaultValue: 0 },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { ...common, tableName: "uploads" },
);

const Sample = sequelize.define(
  "Sample",
  {
    sign_id: { type: DataTypes.INTEGER, allowNull: false },
    upload_id: { type: DataTypes.INTEGER, allowNull: false },
    kind: { type: DataTypes.TEXT, allowNull: false },
    data: { type: DataTypes.JSONB, allowNull: false },
    handedness: { type: DataTypes.TEXT },
    thumb: { type: DataTypes.TEXT },
  },
  { ...common, tableName: "samples" },
);

const ModelVersion = sequelize.define(
  "ModelVersion",
  {
    version: { type: DataTypes.INTEGER, allowNull: false, unique: true },
    status: { type: DataTypes.TEXT, allowNull: false },
    progress: { type: DataTypes.REAL, defaultValue: 0 },
    message: { type: DataTypes.TEXT },
    error: { type: DataTypes.TEXT },
    labels: { type: DataTypes.JSONB },
    motion_labels: { type: DataTypes.JSONB },
    val_accuracy: { type: DataTypes.REAL },
    motion_val_accuracy: { type: DataTypes.REAL },
    report: { type: DataTypes.JSONB },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    trained_at: { type: DataTypes.DATE },
    deployed_at: { type: DataTypes.DATE },
  },
  { ...common, tableName: "model_versions" },
);

const ModelFile = sequelize.define(
  "ModelFile",
  {
    model_id: { type: DataTypes.INTEGER, primaryKey: true },
    name: { type: DataTypes.TEXT, primaryKey: true },
    content: { type: DataTypes.BLOB, allowNull: false },
    sha256: { type: DataTypes.TEXT, allowNull: false },
  },
  { ...common, tableName: "model_files" },
);

Sign.hasMany(Upload, { foreignKey: "sign_id", onDelete: "CASCADE" });
Upload.belongsTo(Sign, { foreignKey: "sign_id" });
Upload.hasMany(Sample, { foreignKey: "upload_id", onDelete: "CASCADE" });
Sample.belongsTo(Upload, { foreignKey: "upload_id" });
ModelVersion.hasMany(ModelFile, { foreignKey: "model_id", as: "files", onDelete: "CASCADE" });

module.exports = { sequelize, Admin, Sign, Upload, Sample, ModelVersion, ModelFile };
