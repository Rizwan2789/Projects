from sqlalchemy import Column, Integer, Text, DateTime, func
from database import Base


class Meeting(Base):
    __tablename__ = "meetings"

    id         = Column(Integer, primary_key=True, index=True)
    title      = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    duration_s = Column(Integer, nullable=True)
    transcript = Column(Text, nullable=True)
    minutes    = Column(Text, nullable=True)
