import asyncio
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import text, String, inspect
import sqlalchemy

load_dotenv()

DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "pgadmin")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "echonotes")
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}",
)


class Base(DeclarativeBase):
    pass


class ConnectionTest(Base):
    __tablename__ = "connection_test"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    message: Mapped[str] = mapped_column(String(255))


async def run():
    safe_url = DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else DATABASE_URL
    print(f"\n{'='*50}")
    print(f"  EchoNotes — Database Connection Test")
    print(f"{'='*50}")
    print(f"  Connecting to: {safe_url}")
    print(f"  SQLAlchemy   : {sqlalchemy.__version__}")

    engine = create_async_engine(DATABASE_URL, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    try:
        # 1. Ping
        async with engine.connect() as conn:
            result = await conn.execute(text("SELECT version()"))
            pg_version = result.scalar()
        print(f"\n[1/4] Connected ✓")
        print(f"      PostgreSQL: {pg_version.split(',')[0]}")

        # 2. Create table
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        print(f"\n[2/4] Table 'connection_test' created (or already exists) ✓")

        # 3. Insert a row
        async with Session() as session:
            row = ConnectionTest(message="Hello from EchoNotes!")
            session.add(row)
            await session.commit()
            await session.refresh(row)
            print(f"\n[3/4] Row inserted ✓")
            print(f"      id      : {row.id}")
            print(f"      message : {row.message}")

        # 4. Read it back
        async with Session() as session:
            result = await session.execute(
                text("SELECT id, message FROM connection_test ORDER BY id DESC LIMIT 5")
            )
            rows = result.fetchall()
        print(f"\n[4/4] Last 5 rows in 'connection_test' ✓")
        print(f"      {'id':<6} {'message'}")
        print(f"      {'-'*40}")
        for r in rows:
            print(f"      {r.id:<6} {r.message}")

        print(f"\n{'='*50}")
        print(f"  All checks passed — database is working!")
        print(f"{'='*50}\n")

    except Exception as e:
        print(f"\n  FAILED: {e}")
        print(f"\n  Checklist:")
        print(f"    - Is PostgreSQL running?")
        print(f"    - Does the database '{DB_NAME}' exist?")
        print(f"    - Are credentials correct in backend/.env?")
        raise
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
