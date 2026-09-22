-- AlterTable
ALTER TABLE "User" ADD COLUMN "firstName" TEXT;
ALTER TABLE "User" ADD COLUMN "middleName" TEXT;
ALTER TABLE "User" ADD COLUMN "lastName" TEXT;

-- Backfill existing rows from the legacy "name" column
UPDATE "User"
SET
    "firstName" = split_part(TRIM("name"), ' ', 1),
    "lastName" = split_part(
        TRIM("name"),
        ' ',
        array_length(string_to_array(TRIM("name"), ' '), 1)
    ),
    "middleName" = CASE
        WHEN array_length(string_to_array(TRIM("name"), ' '), 1) > 2
        THEN array_to_string(
            (string_to_array(TRIM("name"), ' '))[2:array_length(string_to_array(TRIM("name"), ' '), 1) - 1],
            ' '
        )
        ELSE NULL
    END;

-- Make required columns NOT NULL
ALTER TABLE "User" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "lastName" SET NOT NULL;

-- DropColumn
ALTER TABLE "User" DROP COLUMN "name";