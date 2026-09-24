import type { DingtalkDocsToolState } from '../../types';

/**
 * The projected states of contract §E.3, as the server writes them. A card also renders what an
 * old topic stored, so every render still treats each field as possibly missing or malformed.
 */
export type {
  AitableBasesState,
  AitableRecordsState,
  AitableSchemaState,
  AitableTablesState,
  DocsState,
  DocState,
  DriveFilesState,
  SheetRangeState,
  SheetsState,
  WikiNodesState,
  WikiSpacesState,
  WriteState,
} from '../../types';

/** Every projected state of the toolset; `kind` decides the view. */
export type DingtalkDocsRenderState = DingtalkDocsToolState;
