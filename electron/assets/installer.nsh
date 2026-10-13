; Recreates a missing Start menu shortcut on every install and update: a one-click install keeps
; shortcuts once KeepShortcuts is set, and addStartMenuLink then never recreates a lost one.
!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${ifNot} ${FileExists} "$newStartMenuLink"
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
    ${endIf}
  !endif
!macroend

; Unregisters the Chrome native host main registers each launch. Skipped on an update, whose
; uninstall of the old version runs first; the new version's launch re-registers it anyway.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.faststudy.bridge"
  ${endIf}
!macroend
