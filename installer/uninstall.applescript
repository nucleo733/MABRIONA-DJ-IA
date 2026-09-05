-- Desinstalador de MATOKO DJ para macOS
-- ============================================================
-- Borra ÚNICAMENTE lo que le pertenece a MATOKO DJ: la app y los
-- archivos que la propia app crea (configuración, caché, cookies,
-- modelos y caché de separación de pistas). La lista de rutas es fija
-- y está escrita a mano acá — nunca se arma con comodines ni con datos
-- que venga de fuera, justamente para que no pueda llevarse por
-- delante nada ajeno.
--
-- NO toca: música del usuario, documentos, descargas, ninguna otra
-- app ni archivos del sistema. Tampoco desinstala Brave: Brave es un
-- navegador aparte, del usuario, y se queda.

on run
	set rutas to {}
	set libreria to POSIX path of (path to library folder from user domain)

	set candidatas to {¬
		"/Applications/MATOKO DJ.app", ¬
		libreria & "Application Support/MATOKO DJ", ¬
		libreria & "Preferences/com.matoko.dj.plist", ¬
		libreria & "Caches/com.matoko.dj", ¬
		libreria & "Caches/com.matoko.dj.ShipIt", ¬
		libreria & "Logs/MATOKO DJ", ¬
		libreria & "HTTPStorages/com.matoko.dj", ¬
		libreria & "HTTPStorages/com.matoko.dj.binarycookies", ¬
		libreria & "WebKit/com.matoko.dj", ¬
		libreria & "Saved Application State/com.matoko.dj.savedState"}

	repeat with ruta in candidatas
		if existe(ruta as text) then set end of rutas to (ruta as text)
	end repeat

	if (count of rutas) is 0 then
		display dialog "MATOKO DJ no está instalado en esta Mac — no hay nada que borrar." ¬
			buttons {"Cerrar"} default button 1 with title "Desinstalar MATOKO DJ" with icon note
		return
	end if

	set listado to ""
	repeat with ruta in rutas
		set listado to listado & "• " & ruta & return
	end repeat

	display dialog "Se va a borrar solo esto de MATOKO DJ:" & return & return & listado & return & ¬
		"Tu música, tus documentos y el resto de tus aplicaciones no se tocan." ¬
		buttons {"Cancelar", "Desinstalar"} default button "Cancelar" cancel button "Cancelar" ¬
		with title "Desinstalar MATOKO DJ" with icon caution

	-- Se cierra la app si está abierta, para que no queden archivos en uso.
	try
		tell application "MATOKO DJ" to quit
		delay 1
	end try

	set fallaron to {}
	repeat with ruta in rutas
		try
			do shell script "rm -rf " & quoted form of (ruta as text)
		on error
			try
				-- Solo si hace falta permiso (por ejemplo, la app en
				-- /Applications instalada por otro usuario).
				do shell script "rm -rf " & quoted form of (ruta as text) with administrator privileges
			on error
				set end of fallaron to (ruta as text)
			end try
		end try
	end repeat

	if (count of fallaron) is 0 then
		display dialog "MATOKO DJ se desinstaló por completo." & return & return & ¬
			"Nota: si tenías Brave instalado, sigue instalado — es un navegador aparte y no se borra." ¬
			buttons {"Listo"} default button 1 with title "Desinstalar MATOKO DJ" with icon note
	else
		set pendiente to ""
		repeat with ruta in fallaron
			set pendiente to pendiente & "• " & ruta & return
		end repeat
		display dialog "MATOKO DJ se desinstaló, pero esto no se pudo borrar:" & return & return & pendiente ¬
			buttons {"Cerrar"} default button 1 with title "Desinstalar MATOKO DJ" with icon caution
	end if
end run

on existe(ruta)
	try
		do shell script "test -e " & quoted form of ruta
		return true
	on error
		return false
	end try
end existe
