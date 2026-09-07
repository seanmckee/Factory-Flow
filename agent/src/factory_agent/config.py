"""Service configuration, read from the environment and `agent/.env`.

The agent's own settings live here; provider libraries (langchain-openai,
langsmith) read their `OPENAI_API_KEY` / `LANGSMITH_*` variables straight from
the process environment, which is why `main.py` loads the .env file into
`os.environ` before anything imports them.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = ""
    openai_model: str = "gpt-5.1"
    backend_api_base: str = "http://localhost:3000"


settings = Settings()
