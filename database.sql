-- Create database (optional)
-- CREATE DATABASE VideoApp;
-- GO
-- USE VideoApp;
-- GO

IF OBJECT_ID(N'dbo.Video', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Video (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Title NVARCHAR(255) NULL,
    FileName NVARCHAR(255) NOT NULL,
    RelativeUrl NVARCHAR(500) NOT NULL,
    UploadedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
GO

