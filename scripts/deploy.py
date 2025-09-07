#!/usr/bin/env python3
import os
import json
import subprocess
import tempfile
import base58

def deploy_program(program_path):
    """
    Despliega un programa en Solana usando 'solana program deploy'.
    Maneja la recuperación del buffer en caso de error.
    """
    # Verificar que el archivo del programa existe
    if not os.path.exists(program_path):
        print(f"Error: El archivo del programa no existe: {program_path}")
        print("Ejecuta 'anchor build' primero para compilar el programa.")
        return

    # Cargar la clave privada desde la variable de entorno
    private_key_env = os.environ.get("SOLANA_PRIVATE_KEY")
    if not private_key_env:
        print("La variable de entorno 'SOLANA_PRIVATE_KEY' no está definida.")
        return

    try:
        # Decodificar la clave privada en Base58
        keypair_bytes = base58.b58decode(private_key_env)
    except Exception as e:
        print("Error al decodificar la clave privada en Base58:", e)
        return

    # Convertir los bytes a una lista de enteros (se asume un keypair de 64 bytes)
    keypair_list = list(keypair_bytes)
    if len(keypair_list) != 64:
        print("La clave privada decodificada no tiene 64 bytes. Verifica el formato.")
        return

    # Cargar el cluster desde la variable de entorno (por defecto usa 'local')
    cluster = os.environ.get("SOLANA_CLUSTER", "devnet").lower()
    cluster_urls = {
        "local": "http://localhost:8899",
        "devnet": "https://api.devnet.solana.com",
        "testnet": "https://api.testnet.solana.com",
        "mainnet": "https://solana.drpc.org",
        "mainnet-beta": "https://api.mainnet-beta.solana.com"
    }
    if cluster not in cluster_urls:
        print("El valor de 'SOLANA_CLUSTER' no es válido. Usa 'local', 'devnet', 'testnet' o 'mainnet'.")
        return

    cluster_url = cluster_urls[cluster]

    # Escribir la clave privada en un archivo temporal
    with tempfile.NamedTemporaryFile(mode="w", delete=False) as temp_key_file:
        json.dump(keypair_list, temp_key_file)
        temp_key_file_path = temp_key_file.name

    print("Clave privada cargada y almacenada en:", temp_key_file_path)
    print("Cluster seleccionado:", cluster, "URL:", cluster_url)

    try:
        # Intentar desplegar el programa
        result = subprocess.run(
            ["solana", "program", "deploy", "--keypair", temp_key_file_path, "--url", cluster_url, program_path],
            capture_output=True, text=True, check=True
        )
        print("Despliegue exitoso:")
        print(result.stdout)
    except subprocess.CalledProcessError as e:
        error_message = e.stderr.strip() if e.stderr else str(e)
        print("Error al desplegar el programa:")
        print(error_message)

        # Verificar si el error es debido a la pérdida del buffer
        if e.stderr and "Recover the intermediate account's ephemeral keypair file" in e.stderr:
            print("Intentando recuperar el buffer...")

            # Extraer la seed phrase de la salida de error
            lines = e.stderr.split("\n")
            seed_phrase = None
            for i, line in enumerate(lines):
                if "Recover the intermediate account's ephemeral keypair file" in line:
                    if i + 2 < len(lines):
                        seed_phrase = lines[i + 2].strip()
                    break

            if seed_phrase:
                print("Recuperando clave del buffer con la seed phrase...")
                subprocess.run(["solana-keygen", "recover", "ASK", "--force"], input=seed_phrase, text=True)
                
                # Reintentar el despliegue
                print("Reintentando el despliegue...")
                try:
                    result = subprocess.run(
                        ["solana", "program", "deploy", "--keypair", temp_key_file_path, "--url", cluster_url, program_path],
                        capture_output=True, text=True, check=True
                    )
                    print("Despliegue exitoso tras recuperación:")
                    print(result.stdout)
                except subprocess.CalledProcessError as e:
                    print("Error al intentar nuevamente el despliegue después de la recuperación:")
                    print(e.stderr if e.stderr else str(e))
            else:
                print("No se pudo extraer la seed phrase para recuperar el buffer.")
        else:
            print("El error no está relacionado con la pérdida del buffer.")

    finally:
        # Eliminar el archivo temporal con la clave privada
        try:
            os.remove(temp_key_file_path)
        except OSError as e:
            print("No se pudo eliminar el archivo temporal:", e)

if __name__ == "__main__":
    # Ruta al programa .so compilado
    program_path = "target/deploy/sports.so"
    deploy_program(program_path)
