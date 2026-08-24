import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type UserRole = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 16;

export const ROLE_LABELS: Record<UserRole, string> = {
  1: 'Commercial',
  2: 'Gestionnaire de stock',
  3: 'Comptable',
  4: 'Directeur adjoint',
  5: 'Directrice',
  6: 'Administrateur',
  7: 'Directrice commerciale',
  8: 'Responsable de production',
  9: 'Pétrisseur',
  10: 'Commercial',
  11: 'Commercial externe',
  12: 'Agent de sécurité',
  13: 'Plongeuse',
  14: 'Femme de ménage',
  16: 'Assistant en gestion de stock',
};

// This is a distinct job title while keeping only stock-manager operational access.
// Access checks must not let this identifier inherit director or admin permissions.
export function getRoleAccessLevel(role: UserRole | number): number {
  return Number(role) === 16 ? 2 : Number(role);
}

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type PotShape = 'pot' | 'barquette' | 'sachet';

export const POT_SHAPE_LABELS: Record<PotShape, string> = {
  pot: 'Pot',
  barquette: 'Barquette',
  sachet: 'Sachet',
};

export interface PotType {
  id: string;
  name: string;
  madeleine_count: number;
  shape: PotShape;
  unit_price_fcfa: number;
  stock_quantity: number;
  empty_pots_stock: number;
  empty_lids_stock: number;
  madeleines_stock: number;
  low_stock_threshold: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Driver {
  id: string;
  user_id: string | null;
  full_name: string;
  phone_primary: string;
  phone_secondary: string | null;
  address: string | null;
  birth_date: string | null;
  hire_date: string;
  zone: string;
  status: 'actif' | 'inactif' | 'conge';
  vehicle_type: 'moto' | 'velo' | 'voiture' | 'pied';
  license_number: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface SalesPoint {
  id: string;
  name: string;
  address: string | null;
  district: string;
  arrondissement: string | null;
  arrondissements: string[];
  zone: string;
  owner_name: string | null;
  owner_full_name: string | null;
  owner_phone: string | null;
  owner_phone_secondary: string | null;
  owner_email: string | null;
  client_type: 'detail' | 'grossiste' | 'boutique' | 'kiosque' | 'mobile_money' | 'supermarche' | 'restaurant_hotel' | 'entreprise' | 'autre';
  client_type_other: string | null;
  delivery_days: string[];
  photo_url: string | null;
  is_active: boolean;
  is_new: boolean;
  quota_amount: number;
  quota_paid: number;
  quota_status: 'non_paye' | 'partiel' | 'paye';
  gps_lat: number | null;
  gps_lng: number | null;
  created_by: string | null;
  driver_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotaPayment {
  id: string;
  sales_point_id: string;
  amount_fcfa: number;
  payment_date: string;
  collected_by: string | null;
  payment_method: 'especes' | 'mobile_money' | 'virement' | 'autre';
  receipt_number: string | null;
  notes: string | null;
  created_at: string;
}

export type BatchType = 'livraison' | 'recouvrement' | 'mixte';

export const BATCH_TYPE_LABELS: Record<BatchType, string> = {
  livraison: 'Livraison',
  recouvrement: 'Recouvrement',
  mixte: 'Mixte',
};

export interface DeliveryBatch {
  id: string;
  batch_code: string;
  batch_date: string;
  driver_id: string;
  pot_type_id: string | null;
  quantity: number | null;
  zone: string;
  batch_type: BatchType;
  pots_delivered: number;
  pots_returned: number;
  status: 'actif' | 'cloture' | 'annule';
  created_by: string;
  created_at: string;
  updated_at: string;
  driver?: Driver;
  pot_type?: PotType;
  sales_points?: BatchSalesPoint[];
  batch_pot_types?: BatchPotType[];
  approval?: DeliveryBatchApproval;
}

export interface DeliveryBatchApproval {
  id: string;
  batch_id: string;
  status: 'en_attente' | 'approuve' | 'rejete';
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
}

export interface BatchSalesPoint {
  id: string;
  batch_id: string;
  sales_point_id: string;
  created_at: string;
  sales_point?: SalesPoint;
}

export interface BatchPotType {
  id: string;
  batch_id: string;
  pot_type_id: string;
  quantity: number;
  empty_pots: number;
  empty_lids: number;
  created_at: string;
  pot_type?: PotType;
}

export interface Deposit {
  id: string;
  batch_id: string;
  sales_point_id: string;
  quantity: number;
  deposited_at: string;
  gps_lat: number | null;
  gps_lng: number | null;
  photo_url: string | null;
  payment_type: 'comptant' | 'credit';
  amount_fcfa: number;
  is_confirmed: boolean;
  notes: string | null;
  created_at: string;
  sales_point?: SalesPoint;
  batch?: DeliveryBatch;
  receivable?: Receivable;
  pot_type_id?: string | null;
  barcode_id?: string | null;
  barcode?: Barcode;
}

export interface ReturnPotType {
  id: string;
  return_id: string;
  pot_type_id: string;
  quantity: number;
  empty_pots: number;
  empty_lids: number;
  madeleine_count: number;
  created_at: string;
  pot_type?: PotType;
}

export interface Return {
  id: string;
  batch_id: string;
  sales_point_id: string;
  /** Consigne d'origine : conservée afin de pouvoir retracer le retour. */
  consignment_id: string | null;
  pot_type_id: string | null;
  production_record_id: string | null;
  driver_id: string | null;
  quantity: number;
  empty_pots: number;
  empty_lids: number;
  returned_at: string;
  reason: 'peremption' | 'invendu' | 'casse' | 'autre' | null;
  madeleine_count: number;
  item_type: 'pots' | 'madeleines' | 'both';
  notes: string | null;
  created_at: string;
  sales_point?: SalesPoint;
  batch?: DeliveryBatch;
  consignment?: Consignment;
  pot_type?: PotType;
  production_record?: ProductionRecord;
  driver?: Driver;
  return_pot_types?: ReturnPotType[];
}

export interface StockMovement {
  id: string;
  pot_type_id: string;
  movement_type: 'entree' | 'attribution' | 'retour' | 'ajustement';
  item_type: 'pots' | 'madeleines';
  quantity: number;
  driver_id: string | null;
  baker_id: string | null;
  batch_id: string | null;
  reference_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  pot_type?: PotType;
  driver?: Driver;
  baker?: Baker;
  batch?: DeliveryBatch;
}

export interface StockHandover {
  id: string;
  handover_type: 'production_to_stock' | 'stock_to_driver';
  pot_type_id: string;
  quantity: number;
  production_record_id: string | null;
  driver_id: string | null;
  batch_id: string | null;
  performed_by: string | null;
  handover_date: string;
  notes: string | null;
  created_at: string;
  pot_type?: PotType;
  driver?: Driver;
  batch?: DeliveryBatch;
  production_record?: ProductionRecord;
}

export interface DeliveryEvent {
  id: string;
  event_type: 'lot_cree' | 'depot' | 'retour' | 'tournee_close' | 'tournee_annulee' | 'stock_mouvement' | 'livraison_pate' | 'production_stock' | 'remise_pots';
  batch_id: string | null;
  driver_id: string | null;
  sales_point_id: string | null;
  quantity: number | null;
  description: string | null;
  performed_by: string | null;
  occurred_at: string;
  meta: Record<string, unknown> | null;
  driver?: Driver;
  sales_point?: SalesPoint;
  batch?: DeliveryBatch;
}

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  is_read: boolean;
  link_page: string | null;
  priority: 'haute' | 'moyenne' | 'basse';
  created_at: string;
  archived_at: string | null;
}

export interface Receivable {
  id: string;
  deposit_id: string | null;
  sales_point_id: string;
  batch_id: string;
  driver_id: string | null;
  amount_fcfa: number;
  amount_paid: number;
  status: 'en_attente' | 'partiel' | 'solde';
  created_at: string;
  updated_at: string;
  sales_point?: SalesPoint;
  batch?: DeliveryBatch;
  driver?: Driver;
}

export interface ReceivablePayment {
  id: string;
  receivable_id: string;
  amount_fcfa: number;
  payment_date: string;
  collected_by: string;
  no_payment_reason: string | null;
  notes: string | null;
  batch_id: string | null;
  created_at: string;
}

export interface ComplianceCheck {
  id: string;
  batch_id: string;
  expected_amount: number;
  reported_amount: number;
  status: 'en_attente' | 'conforme' | 'non_conforme';
  checked_by: string | null;
  checked_at: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
  batch?: DeliveryBatch & { driver?: Driver; pot_type?: PotType };
}

export interface ComplianceDiscrepancy {
  id: string;
  chain_stage: 'pate_production' | 'production_stock' | 'stock_livraison' | 'poids_seau';
  entity_type: string;
  entity_id: string | null;
  entity_label: string;
  expected_qty: number;
  actual_qty: number;
  variance: number;
  unit: string;
  status: 'non_resolu' | 'resolu' | 'valide' | 'rejete';
  comment: string | null;
  detected_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  validated_by: string | null;
  validated_at: string | null;
  notified_roles: number[];
}

export interface ComplianceComment {
  id: string;
  discrepancy_id: string;
  author_id: string;
  author_name: string;
  author_role: number;
  comment: string;
  created_at: string;
}

export interface ComplianceAuditEntry {
  id: string;
  decision_type: 'valide' | 'rejete' | 'conforme' | 'non_conforme';
  entity_type: 'discrepancy' | 'financial_check';
  entity_id: string;
  entity_label: string;
  chain_stage: string | null;
  decided_by: string | null;
  decided_by_name: string;
  decided_by_role: number;
  decision_comment: string | null;
  previous_status: string | null;
  new_status: string | null;
  decided_at: string;
}

export interface Consignment {
  id: string;
  sales_point_id: string;
  batch_id: string | null;
  pot_type_id: string | null;
  production_record_id: string | null;
  driver_id: string | null;
  quantity_deposited: number;
  quantity_returned: number;
  deposited_at: string;
  created_by: string;
  notes: string | null;
  created_at: string;
  sales_point?: SalesPoint;
  pot_type?: PotType;
  production_record?: ProductionRecord;
  driver?: Driver;
}

export interface RestockRequest {
  id: string;
  sales_point_id: string;
  pot_type_id: string;
  quantity: number;
  status: 'en_attente' | 'traitee' | 'annulee';
  requested_by: string;
  treated_by: string | null;
  treated_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  sales_point?: SalesPoint;
  pot_type?: PotType;
  requester?: Profile;
}

export type LeaveStatus = 'present' | 'absent' | 'conge_annuel' | 'permission' | 'day_off' | 'maladie';
export type NotificationStatus = 'pending' | 'notified' | 'approved' | 'rejected';

export const LEAVE_STATUS_LABELS: Record<LeaveStatus, string> = {
  present: 'Présent',
  absent: 'Absent',
  conge_annuel: 'Congé annuel',
  permission: 'Permission accordée',
  day_off: 'Day off',
  maladie: 'Maladie',
};

export const LEAVE_STATUS_META: Record<LeaveStatus, { label: string; color: string; bgColor: string; borderColor: string; dot: string }> = {
  present: { label: 'Présent', color: 'text-emerald-700', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200', dot: 'bg-emerald-500' },
  absent: { label: 'Absent', color: 'text-red-700', bgColor: 'bg-red-50', borderColor: 'border-red-200', dot: 'bg-red-500' },
  conge_annuel: { label: 'Congé annuel', color: 'text-amber-700', bgColor: 'bg-amber-50', borderColor: 'border-amber-200', dot: 'bg-amber-500' },
  permission: { label: 'Permission accordée', color: 'text-blue-700', bgColor: 'bg-blue-50', borderColor: 'border-blue-200', dot: 'bg-blue-500' },
  day_off: { label: 'Day off', color: 'text-violet-700', bgColor: 'bg-violet-50', borderColor: 'border-violet-200', dot: 'bg-violet-500' },
  maladie: { label: 'Maladie', color: 'text-rose-700', bgColor: 'bg-rose-50', borderColor: 'border-rose-200', dot: 'bg-rose-500' },
};

export interface LeavePeriod {
  id: string;
  driver_id: string | null;
  substitute_driver_id: string | null;
  profile_id: string | null;
  start_date: string;
  end_date: string;
  reason: string | null;
  status: LeaveStatus;
  notified_to: string | null;
  notification_status: NotificationStatus;
  created_by: string;
  created_at: string;
  driver?: Driver;
  substitute?: Driver;
  profile?: Profile;
  notified_profile?: Profile;
}

export interface Baker {
  id: string;
  full_name: string;
  phone: string | null;
  status: 'actif' | 'inactif';
  avatar_url: string | null;
  notes: string | null;
  profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Kneader {
  id: string;
  full_name: string;
  phone: string | null;
  status: 'actif' | 'inactif';
  avatar_url: string | null;
  notes: string | null;
  profile_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DoughDelivery {
  id: string;
  kneader_id: string;
  baker_id: string;
  bucket_count: number;
  bucket_weight_kg: number;
  total_weight_kg: number;
  delivery_date: string;
  notes: string | null;
  created_by: string;
  created_at: string;
  kneader?: Kneader;
  baker?: Baker;
  dough_batch_id?: string | null;
  dough_batch?: DoughBatch;
}

export interface ProductionRecord {
  id: string;
  baker_id: string;
  pot_type_id: string;
  quantity: number;
  pots_burned: number;
  madeleines_good: number;
  madeleines_burned: number;
  madeleines_broken: number;
  madeleines_defective: number;
  dough_delivery_id: string | null;
  dough_used_kg: number | null;
  buckets_used: number | null;
  cakes_baked: number;
  pates_count: number | null;
  expected_madeleines: number | null;
  madeleine_variance: number | null;
  production_date: string;
  notes: string | null;
  created_by: string;
  created_at: string;
  baker?: Baker;
  pot_type?: PotType;
  dough_delivery?: DoughDelivery;
}

export const PATE_WEIGHT_KG = 7.5;
export const MADELEINES_PER_PATE = 471;
export const MADELEINE_VARIANCE_TOLERANCE_PCT = 5;

export const PATE_RECIPE: { ingredient: string; quantity_per_pate: number; unit: string; label: string }[] = [
  { ingredient: 'farine', quantity_per_pate: 2.6, unit: 'kg', label: 'Farine' },
  { ingredient: 'sucre', quantity_per_pate: 1.5, unit: 'kg', label: 'Sucre' },
  { ingredient: 'huile', quantity_per_pate: 1.5, unit: 'L', label: 'Huile' },
  { ingredient: 'levure', quantity_per_pate: 1, unit: 'paquet', label: 'Levure (1 paquet)' },
  { ingredient: 'oeuf', quantity_per_pate: 36, unit: 'unites', label: 'Oeufs (1 palette + 6 oeufs)' },
];
export const INGREDIENT_VARIANCE_TOLERANCE_PCT = 5;

export interface PersonnelChangeRequest {
  id: string;
  entity_type: 'driver' | 'kneader' | 'baker';
  action_type: 'create' | 'update' | 'delete';
  entity_id: string | null;
  payload: Record<string, unknown>;
  status: 'en_attente' | 'validee' | 'rejetee';
  requested_by: string | null;
  directrice_approved_by: string | null;
  directrice_approved_at: string | null;
  adjoint_approved_by: string | null;
  adjoint_approved_at: string | null;
  admin_approved_by: string | null;
  admin_approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  applied: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  requester?: Profile;
}

export interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  performed_by: string | null;
  performed_by_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface Barcode {
  id: string;
  code: string;
  pot_type_id: string;
  quantity: number;
  notes: string | null;
  is_used: boolean;
  used_at: string | null;
  created_by: string;
  created_at: string;
  pot_type?: PotType;
  baker_id: string;
  baker_code: string | null;
  baker?: Baker;
  baker2_id: string;
  baker2_code: string | null;
  baker2?: Baker;
  production_record_id: string | null;
  production_record?: ProductionRecord;
  deposit_barcodes?: DepositBarcodeLink[];
}

export interface DepositBarcodeLink {
  id: string;
  deposit_id: string;
  barcode_id: string;
  scanned_at: string;
  scanned_by: string | null;
  created_at: string;
  deposit?: {
    id: string;
    deposited_at: string;
    sales_point?: Pick<SalesPoint, 'id' | 'name'>;
    batch?: Pick<DeliveryBatch, 'id' | 'batch_code'> & {
      driver?: Pick<Driver, 'id' | 'full_name'>;
    };
  };
}

export type SchedulePersonType = 'driver' | 'baker' | 'kneader';
export type ScheduleStatus = 'planifie' | 'en_cours' | 'termine' | 'annule';

export const SCHEDULE_PERSON_LABELS: Record<SchedulePersonType, string> = {
  driver: 'Commercial',
  baker: 'Pétrisseur',
  kneader: 'Pétrisseur',
};

export const SCHEDULE_STATUS_LABELS: Record<ScheduleStatus, string> = {
  planifie: 'Planifié',
  en_cours: 'En cours',
  termine: 'Terminé',
  annule: 'Annulé',
};

export const SCHEDULE_STATUS_META: Record<ScheduleStatus, { label: string; color: string; bgColor: string; dot: string }> = {
  planifie: { label: 'Planifié', color: 'text-blue-700', bgColor: 'bg-blue-50', dot: 'bg-blue-500' },
  en_cours: { label: 'En cours', color: 'text-amber-700', bgColor: 'bg-amber-50', dot: 'bg-amber-500' },
  termine: { label: 'Terminé', color: 'text-emerald-700', bgColor: 'bg-emerald-50', dot: 'bg-emerald-500' },
  annule: { label: 'Annulé', color: 'text-red-700', bgColor: 'bg-red-50', dot: 'bg-red-500' },
};

export interface WorkSchedule {
  id: string;
  person_type: SchedulePersonType;
  person_id: string;
  person_name: string;
  work_date: string;
  start_time: string | null;
  end_time: string | null;
  zone: string | null;
  task: string | null;
  status: ScheduleStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ObservationCategory = 'livraison' | 'fabrication_pate' | 'cuisson' | 'stock' | 'autre';
export type ObservationPriority = 'info' | 'normale' | 'importante';
export type ObservationStatus = 'ouvert' | 'en_cours' | 'resolu' | 'ferme';

export const OBSERVATION_CATEGORY_LABELS: Record<ObservationCategory, string> = {
  livraison: 'Livraison',
  fabrication_pate: 'Fabrication de pâte',
  cuisson: 'Cuisson',
  stock: 'Gestion de stock',
  autre: 'Autre',
};

export const OBSERVATION_PRIORITY_LABELS: Record<ObservationPriority, string> = {
  info: 'Information',
  normale: 'Normale',
  importante: 'Importante',
};

export const OBSERVATION_PRIORITY_META: Record<ObservationPriority, { label: string; color: string; bgColor: string; borderColor: string }> = {
  info:       { label: 'Information',  color: 'text-blue-700',   bgColor: 'bg-blue-50',   borderColor: 'border-blue-200' },
  normale:    { label: 'Normale',      color: 'text-gray-700',   bgColor: 'bg-gray-50',   borderColor: 'border-gray-200' },
  importante: { label: 'Importante',   color: 'text-rose-700',   bgColor: 'bg-rose-50',   borderColor: 'border-rose-200' },
};

export const OBSERVATION_STATUS_LABELS: Record<ObservationStatus, string> = {
  ouvert: 'Ouvert',
  en_cours: 'En cours',
  resolu: 'Résolu',
  ferme: 'Fermé',
};

export const OBSERVATION_STATUS_META: Record<ObservationStatus, { label: string; color: string; bgColor: string; dot: string }> = {
  ouvert:    { label: 'Ouvert',    color: 'text-amber-700',   bgColor: 'bg-amber-50',   dot: 'bg-amber-500' },
  en_cours:  { label: 'En cours',  color: 'text-blue-700',    bgColor: 'bg-blue-50',    dot: 'bg-blue-500' },
  resolu:    { label: 'Résolu',     color: 'text-emerald-700', bgColor: 'bg-emerald-50',  dot: 'bg-emerald-500' },
  ferme:     { label: 'Fermé',      color: 'text-gray-600',    bgColor: 'bg-gray-100',   dot: 'bg-gray-400' },
};

export interface FieldObservationComment {
  id: string;
  observation_id: string;
  author_id: string;
  author_name: string;
  author_role: number;
  comment: string;
  created_at: string;
}

export interface FieldObservation {
  id: string;
  author_id: string;
  author_name: string;
  author_role: number;
  category: ObservationCategory;
  priority: ObservationPriority;
  title: string;
  body: string;
  related_batch_id: string | null;
  related_sales_point_id: string | null;
  related_production_id: string | null;
  status: ObservationStatus;
  created_at: string;
  updated_at: string;
  comments?: FieldObservationComment[];
}

export type ExpenseType =
  | 'carburant'
  | 'huile_moteur'
  | 'depannage'
  | 'gonflage_pneus'
  | 'location_voiture'
  | 'papiers'
  | 'madeleines_avaries'
  | 'madeleines_manquants'
  | 'transfert_argent'
  | 'frais_transfert'
  | 'recuperation_caisse'
  | 'expedition_caisse'
  | 'ration'
  | 'credit_autorise'
  | 'papier_pdv'
  | 'autre';

export const EXPENSE_TYPE_LABELS: Record<ExpenseType, string> = {
  carburant: 'Carburant',
  huile_moteur: 'Huile moteur',
  depannage: 'Dépannage',
  gonflage_pneus: 'Gonflage pneus',
  location_voiture: 'Location voiture',
  papiers: 'Papiers',
  madeleines_avaries: 'Madeleines avariés',
  madeleines_manquants: 'Madeleines manquants',
  transfert_argent: "Transfert d'argent",
  frais_transfert: 'Frais de transfert',
  recuperation_caisse: 'Récupération caisse',
  expedition_caisse: 'Expédition caisse',
  ration: 'Ration',
  credit_autorise: 'Crédit sous autorisation',
  papier_pdv: 'Papier PDV',
  autre: 'Autre',
};

export interface DeliveryExpense {
  id: string;
  deposit_id: string | null;
  batch_id: string | null;
  sales_point_id: string | null;
  driver_id: string | null;
  amount_fcfa: number;
  reason: string;
  expense_type: ExpenseType;
  authorized_by: string | null;
  expense_date: string;
  tournee: string | null;
  created_at: string;
  sales_point?: SalesPoint;
  driver?: Driver;
}

export interface AttendanceRecord {
  id: string;
  person_id: string;
  person_name: string;
  person_role: UserRole;
  person_type: 'profile' | 'driver' | 'baker' | 'kneader';
  attendance_date: string;
  arrival_time: string | null;
  departure_time: string | null;
  status: 'present' | 'absent' | 'retard' | 'conge' | 'mission';
  notes: string | null;
  recorded_by: string | null;
  photo_url: string | null;
  departure_photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceRecord['status'], string> = {
  present: 'Présent',
  absent: 'Absent',
  retard: 'En retard',
  conge: 'En congé',
  mission: 'En mission',
};

export const ATTENDANCE_STATUS_META: Record<AttendanceRecord['status'], { label: string; color: string; bgColor: string; dot: string }> = {
  present: { label: 'Présent', color: 'text-emerald-700', bgColor: 'bg-emerald-50', dot: 'bg-emerald-500' },
  absent: { label: 'Absent', color: 'text-red-700', bgColor: 'bg-red-50', dot: 'bg-red-500' },
  retard: { label: 'En retard', color: 'text-amber-700', bgColor: 'bg-amber-50', dot: 'bg-amber-500' },
  conge: { label: 'En congé', color: 'text-blue-700', bgColor: 'bg-blue-50', dot: 'bg-blue-500' },
  mission: { label: 'En mission', color: 'text-purple-700', bgColor: 'bg-purple-50', dot: 'bg-purple-500' },
};

export function generateBakerCode(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const lastName = parts[0] ?? '';
  const firstName = parts[1] ?? '';
  const ln = lastName.toUpperCase();
  const fn = firstName.toUpperCase();
  const part1 = ln.substring(0, 2).padEnd(2, 'X');
  const part2 = fn.substring(0, 1).padEnd(1, 'X');
  return `${part1}${part2}`;
}

export interface Supplier {
  id: string;
  last_name: string;
  first_name: string;
  supplier_code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  unit_cost_fcfa: number;
  category: string | null;
  stock_quantity: number;
  stock_alert_threshold: number | null;
  supplier: string | null;
  supplier_id: string | null;
  package_unit: string | null;
  package_capacity: number | null;
  sub_package_unit: string | null;
  sub_package_capacity: number | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  supplier_ref?: Supplier;
}

export interface PackagingBreakdown {
  packages: number;
  remainingBase: number;
  subPackages: number;
}

export function getPackagingBreakdown(ingredient: Ingredient, baseQty: number): PackagingBreakdown | null {
  if (!ingredient.package_unit || !ingredient.package_capacity || ingredient.package_capacity <= 0) return null;
  const packages = Math.floor(baseQty / ingredient.package_capacity);
  const remainingBase = baseQty - packages * ingredient.package_capacity;
  let subPackages = 0;
  if (ingredient.sub_package_unit && ingredient.sub_package_capacity && ingredient.sub_package_capacity > 0 && remainingBase > 0) {
    subPackages = Math.ceil(remainingBase * ingredient.sub_package_capacity);
  }
  return { packages, remainingBase, subPackages };
}

export function formatPackaging(ingredient: Ingredient, baseQty: number): string {
  const bd = getPackagingBreakdown(ingredient, baseQty);
  if (!bd) return `${baseQty} ${ingredient.unit}`;
  const parts: string[] = [];
  if (bd.packages > 0) parts.push(`${bd.packages} ${ingredient.package_unit}${bd.packages > 1 ? 's' : ''}`);
  if (bd.subPackages > 0 && ingredient.sub_package_unit) {
    parts.push(`${bd.subPackages} ${ingredient.sub_package_unit}${bd.subPackages > 1 ? 's' : ''}`);
  } else if (bd.remainingBase > 0) {
    parts.push(`${bd.remainingBase} ${ingredient.unit}`);
  }
  return parts.length > 0 ? parts.join(' + ') : `0 ${ingredient.unit}`;
}

export interface DoughBatchIngredient {
  id: string;
  dough_batch_id: string;
  ingredient_id: string;
  quantity: number;
  unit_cost_fcfa: number;
  line_cost_fcfa: number;
  ingredient?: Ingredient;
  created_at: string;
}

export interface DoughBatch {
  id: string;
  batch_date: string;
  kneader_id: string | null;
  total_weight_kg: number | null;
  total_cost_fcfa: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  kneader?: Kneader;
  ingredients?: DoughBatchIngredient[];
  deliveries?: DoughDelivery[];
}

export const INGREDIENT_CATEGORIES = [
  'Farines', 'Levures', 'Sucres', 'Œufs', 'Produits frais', 'Matières grasses', 'Arômes & parfums', 'Emballages', 'Autres',
] as const;

export const formatFCFA = (amount: number) =>
  new Intl.NumberFormat('fr-FR').format(amount) + ' FCFA';

export const logAudit = async (
  action: string,
  entityType: string,
  entityId?: string,
  entityLabel?: string,
  details?: Record<string, unknown>,
  performedByName?: string
) => {
  await supabase.from('audit_logs').insert({
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    entity_label: entityLabel ?? null,
    performed_by: (await supabase.auth.getUser()).data.user?.id ?? null,
    performed_by_name: performedByName ?? null,
    details: details ?? null,
  });
};

export const createNotification = async (
  userId: string,
  title: string,
  message: string,
  type: AppNotification['type'] = 'info',
  linkPage?: string
) => {
  await supabase.from('app_notifications').insert({
    user_id: userId,
    title,
    message,
    type,
    link_page: linkPage ?? null,
  });
};

export const createShortfallReceivable = async (
  depositId: string,
  salesPointId: string,
  batchId: string,
  driverId: string | null,
  expectedAmount: number,
  actualAmount: number,
) => {
  const shortfall = expectedAmount - actualAmount;
  if (shortfall <= 0) return null;

  const { data: receivable, error } = await supabase.from('receivables').insert({
    deposit_id: depositId,
    sales_point_id: salesPointId,
    batch_id: batchId,
    driver_id: driverId,
    amount_fcfa: expectedAmount,
    amount_paid: 0,
    status: 'en_attente',
  }).select().single();

  if (error) {
    console.error('shortfall receivable insert failed:', error);
    return null;
  }

  if (actualAmount > 0) {
    const { error: payErr } = await supabase.from('receivable_payments').insert({
      receivable_id: receivable.id,
      amount_fcfa: actualAmount,
      notes: 'Paiement comptant partiel enregistré à la livraison',
    });
    if (payErr) console.error('shortfall receivable payment insert failed:', payErr);
  }

  const { data: admins } = await supabase
    .from('profiles')
    .select('id')
    .gte('role', 4);

  const message =
    `Paiement comptant partiel — Attendu ${formatFCFA(expectedAmount)}, ` +
    `reçu ${formatFCFA(actualAmount)}. Reste à encaisser : ${formatFCFA(shortfall)}. ` +
    `La créance a été créée automatiquement avec le statut « partiel ».`;

  for (const admin of admins ?? []) {
    await createNotification(
      admin.id,
      'Paiement comptant partiel',
      message,
      'warning',
      'receivables',
    );
  }

  return receivable;
};

export interface OpportunisticSale {
  id: string;
  driver_id: string;
  pot_type_id: string | null;
  item_description: string;
  quantity: number;
  unit_price_fcfa: number;
  total_amount_fcfa: number;
  payment_type: 'comptant' | 'credit';
  customer_name: string | null;
  customer_phone: string | null;
  sale_date: string;
  sale_context: 'standard' | 'fair';
  fair_name: string | null;
  fair_location: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  driver?: Driver;
  pot_type?: PotType;
}

export type WeddingOrderStatus = 'en_attente' | 'confirme' | 'livre' | 'annule';
export type WeddingPaymentStatus = 'non_paye' | 'partiel' | 'paye';

export const WEDDING_ORDER_STATUS_LABELS: Record<WeddingOrderStatus, string> = {
  en_attente: 'En attente',
  confirme: 'Confirmé',
  livre: 'Livré',
  annule: 'Annulé',
};

export const WEDDING_ORDER_STATUS_META: Record<WeddingOrderStatus, { label: string; color: string; bgColor: string; dot: string }> = {
  en_attente: { label: 'En attente', color: 'text-amber-700', bgColor: 'bg-amber-50', dot: 'bg-amber-500' },
  confirme: { label: 'Confirmé', color: 'text-blue-700', bgColor: 'bg-blue-50', dot: 'bg-blue-500' },
  livre: { label: 'Livré', color: 'text-emerald-700', bgColor: 'bg-emerald-50', dot: 'bg-emerald-500' },
  annule: { label: 'Annulé', color: 'text-red-700', bgColor: 'bg-red-50', dot: 'bg-red-500' },
};

export const WEDDING_PAYMENT_STATUS_LABELS: Record<WeddingPaymentStatus, string> = {
  non_paye: 'Non payé',
  partiel: 'Partiel',
  paye: 'Payé',
};

export const WEDDING_PAYMENT_STATUS_META: Record<WeddingPaymentStatus, { label: string; color: string; bgColor: string; dot: string }> = {
  non_paye: { label: 'Non payé', color: 'text-red-700', bgColor: 'bg-red-50', dot: 'bg-red-500' },
  partiel: { label: 'Partiel', color: 'text-amber-700', bgColor: 'bg-amber-50', dot: 'bg-amber-500' },
  paye: { label: 'Payé', color: 'text-emerald-700', bgColor: 'bg-emerald-50', dot: 'bg-emerald-500' },
};

export interface WeddingOrder {
  id: string;
  driver_id: string;
  pot_type_id: string | null;
  quantity: number;
  unit_price_fcfa: number;
  total_amount_fcfa: number;
  bride_name: string | null;
  groom_name: string | null;
  customer_phone: string | null;
  wedding_date: string | null;
  delivery_address: string | null;
  status: WeddingOrderStatus;
  payment_status: WeddingPaymentStatus;
  amount_paid_fcfa: number;
  order_date: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  driver?: Driver;
  pot_type?: PotType;
};
