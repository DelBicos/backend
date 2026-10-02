import { UserModel } from "./User";
import { ClientModel } from "./Client";
import { ProfessionalModel } from "./Professional";
import { AdminModel } from "./Admin";
import { AddressModel } from "./Address";
import { CategoryModel } from "./Category";
import { SubCategoryModel } from "./Subcategory";
import { ServiceModel } from "./Service";
import { ServiceAvailabilityModel } from "./ServiceAvailability";
import { AmenitiesModel } from "./Amenities";
import { ProfessionalAmenityModel } from "./ProfessionalAmenities";
import { ProfessionalGalleryModel } from "./ProfessionalGallery";
import { ProfessionalAvailabilityModel } from "./ProfessionalAvailability";
import { ProfessionalAvailabilityLockModel } from "./ProfessionalAvailabilityLock";
import { AppointmentModel } from "./Appointment";
import { AdminServiceOrderModel } from "./AdminServiceOrder";
import { UserTokenModel } from "./UserToken";
import { FavoriteModel } from "./Favorite";
import { ChatRoomModel } from "./ChatRoom";
import { BotChatSessionModel } from "./BotChatSession";
import { BotChatMessageModel } from "./BotChatMessage";

export function initializeAssociations() {
  // User associations
  UserModel.hasOne(ClientModel, {
    foreignKey: "user_id",
    as: "Client",
  });

  UserModel.hasOne(ProfessionalModel, {
    foreignKey: "user_id",
    as: "Professional",
  });

  UserModel.hasOne(AdminModel, {
    foreignKey: "user_id",
    as: "Admin",
  });

  UserModel.hasMany(AddressModel, {
    foreignKey: "user_id",
    as: "Addresses",
  });

  UserModel.hasOne(UserTokenModel, {
    foreignKey: "user_id",
    as: "UserToken",
  });
  UserTokenModel.belongsTo(UserModel, {
    foreignKey: "user_id",
    as: "User",
  });

  UserModel.hasMany(FavoriteModel, {
    foreignKey: "user_id",
    as: "Favorites",
  });

  // Address associations
  AddressModel.belongsTo(UserModel, {
    foreignKey: "user_id",
    as: "User",
  });

  AddressModel.hasOne(ClientModel, {
    foreignKey: "main_address_id",
    as: "ClientsUsingAsMain",
  });

  AddressModel.hasOne(ProfessionalModel, {
    foreignKey: "main_address_id",
    as: "ProfessionalsUsingAsMain",
  });

  AddressModel.hasMany(AppointmentModel, {
    foreignKey: "address_id",
    as: "Appointments",
  });

  // Client associations
  ClientModel.belongsTo(UserModel, {
    foreignKey: "user_id",
    as: "User",
  });

  ClientModel.belongsTo(AddressModel, {
    foreignKey: "main_address_id",
    as: "MainAddress",
  });

  ClientModel.hasMany(AppointmentModel, {
    foreignKey: "client_id",
    as: "Appointments",
  });

  // Professional associations
  ProfessionalModel.belongsTo(UserModel, {
    foreignKey: "user_id",
    as: "User",
  });

  ProfessionalModel.belongsTo(AddressModel, {
    foreignKey: "main_address_id",
    as: "MainAddress",
  });

  ProfessionalModel.hasMany(ServiceModel, {
    foreignKey: "professional_id",
    as: "Services",
  });

  ProfessionalModel.belongsToMany(AmenitiesModel, {
    through: "professional_amenities",
    foreignKey: "professional_id",
    otherKey: "amenity_id",
    as: "Amenities",
  });

  ProfessionalModel.hasMany(ProfessionalGalleryModel, {
    foreignKey: "professional_id",
    as: "Gallery",
  });

  ProfessionalModel.hasMany(ProfessionalAvailabilityModel, {
    foreignKey: "professional_id",
    as: "Availabilities",
  });

  ProfessionalModel.hasMany(ProfessionalAvailabilityLockModel, {
    foreignKey: "professional_id",
    as: "AvailabilityLocks",
  });

  ProfessionalModel.hasMany(AppointmentModel, {
    foreignKey: "professional_id",
    as: "Appointments",
  });

  ProfessionalModel.hasMany(FavoriteModel, {
    foreignKey: "professional_id",
    as: "FavoritedBy",
  });

  // Admin associations
  AdminModel.belongsTo(UserModel, {
    foreignKey: "user_id",
    as: "User",
  });

  AdminModel.hasMany(AdminServiceOrderModel, {
    foreignKey: "admin_id",
    as: "ServiceOrders",
  });

  // Category associations
  CategoryModel.hasMany(SubCategoryModel, {
    foreignKey: "category_id",
    as: "Subcategories",
  });

  // SubCategory associations
  SubCategoryModel.belongsTo(CategoryModel, {
    foreignKey: "category_id",
    as: "Category",
  });

  SubCategoryModel.hasMany(ServiceModel, {
    foreignKey: "subcategory_id",
    as: "Services",
  });

  // Service associations
  ServiceModel.belongsTo(SubCategoryModel, {
    foreignKey: "subcategory_id",
    as: "Subcategory",
  });

  ServiceModel.belongsTo(CategoryModel, {
    foreignKey: "category_id",
    as: "Category",
  });

  ServiceModel.belongsTo(ProfessionalModel, {
    foreignKey: "professional_id",
    as: "Professional",
  });

  ServiceModel.hasMany(AppointmentModel, {
    foreignKey: "service_id",
    as: "Appointments",
  });

  ServiceModel.hasMany(ServiceAvailabilityModel, {
    foreignKey: "service_id",
    as: "Availabilities",
  });

  // ServiceAvailability associations
  ServiceAvailabilityModel.belongsTo(ServiceModel, {
    foreignKey: "service_id",
    as: "Service",
  });

  // Amenities associations
  AmenitiesModel.belongsToMany(ProfessionalModel, {
    through: ProfessionalAmenityModel,
    foreignKey: "amenity_id",
    otherKey: "professional_id",
    as: "Professionals",
  });

  // ProfessionalAmenity associations
  ProfessionalAmenityModel.belongsTo(ProfessionalModel, {
    foreignKey: "professional_id",
    as: "Professional",
  });

  ProfessionalAmenityModel.belongsTo(AmenitiesModel, {
    foreignKey: "amenity_id",
    as: "Amenity",
  });

  // ProfessionalGallery associations
  ProfessionalGalleryModel.belongsTo(ProfessionalModel, {
    foreignKey: "professional_id",
    as: "Professional",
  });

  // ProfessionalAvailability associations
  ProfessionalAvailabilityModel.belongsTo(ProfessionalModel, {
    foreignKey: "professional_id",
    as: "Professional",
  });

  // ProfessionalAvailabilityLock associations
  ProfessionalAvailabilityLockModel.belongsTo(ProfessionalModel, {
    foreignKey: "professional_id",
    as: "Professional",
  });

  // Appointment associations
  AppointmentModel.belongsTo(ProfessionalModel, {
    foreignKey: "professional_id",
    as: "Professional",
  });

  AppointmentModel.belongsTo(ClientModel, {
    foreignKey: "client_id",
    as: "Client",
  });

  AppointmentModel.belongsTo(ServiceModel, {
    foreignKey: "service_id",
    as: "Service",
  });

  AppointmentModel.belongsTo(AddressModel, {
    foreignKey: "address_id",
    as: "Address",
  });

  AppointmentModel.hasMany(AdminServiceOrderModel, {
    foreignKey: "appointment_id",
    as: "ServiceOrders",
  });

  // AdminServiceOrder associations
  AdminServiceOrderModel.belongsTo(AdminModel, {
    foreignKey: "admin_id",
    as: "Admin",
  });

  AdminServiceOrderModel.belongsTo(AppointmentModel, {
    foreignKey: "appointment_id",
    as: "Appointment",
  });

  // Favorite associations
  FavoriteModel.belongsTo(UserModel, {
    foreignKey: "user_id",
    as: "User",
  });

  FavoriteModel.belongsTo(ProfessionalModel, {
    foreignKey: "professional_id",
    as: "Professional",
  });

  // ChatRoom associations
  AppointmentModel.hasOne(ChatRoomModel, {
    foreignKey: "appointment_id",
    as: "ChatRoom",
  });

  ChatRoomModel.belongsTo(AppointmentModel, {
    foreignKey: "appointment_id",
    as: "Appointment",
  });

  ChatRoomModel.belongsTo(ProfessionalModel, {
    foreignKey: "professional_id",
    as: "Professional",
  });

  ChatRoomModel.belongsTo(ClientModel, {
    foreignKey: "client_id",
    as: "Client",
  });

  ChatRoomModel.belongsTo(ServiceModel, {
    foreignKey: "service_id",
    as: "Service",
  });

  // Bot Chatbot associations
  UserModel.hasMany(BotChatSessionModel, {
    foreignKey: "user_id",
    as: "BotSessions",
  });

  BotChatSessionModel.belongsTo(UserModel, {
    foreignKey: "user_id",
    as: "User",
  });

  BotChatSessionModel.hasMany(BotChatMessageModel, {
    foreignKey: "session_id",
    as: "Messages",
  });

  BotChatMessageModel.belongsTo(BotChatSessionModel, {
    foreignKey: "session_id",
    as: "Session",
  });

  BotChatSessionModel.belongsTo(AppointmentModel, {
    foreignKey: "appointment_id",
    as: "Appointment",
  });
}
