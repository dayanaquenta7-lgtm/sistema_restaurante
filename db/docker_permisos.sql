-- Solo para Docker: el backend necesita este permiso para actualizar
-- los triggers y procedimientos que MySQL creó con el usuario root.
GRANT SYSTEM_USER ON *.* TO 'broasteria_app'@'%';
